// Experimental App Clip building block. Requires an iOS target and device validation.
import ARKit
import Foundation
import CoreImage
import ImageIO
import CryptoKit
import JavaScriptCore
import Vision

private struct LumaQuality {
    let sharpness: Double
    let dark: Double
    let bright: Double
}

final class ARKitCaptureController: NSObject, ARSessionDelegate {
    let session = ARSession()
    private let queue = DispatchQueue(label: "ffs.guided-capture")
    private let imageContext = CIContext()
    private var context: JSContext!
    private var bridge: JSValue!
    private let archiveRoot: URL
    private let sessionID = UUID().uuidString
    private var segment = UUID().uuidString
    private var bridgeFailure = false
    private var automatic = false
    private var sweepMode = false
    private var streamFPS = 0
    private var candidate: (frame: ARFrame, id: String, quality: LumaQuality?, bounds: CGRect?)?
    private var confirmedPoint: SIMD3<Float>?
    private var previousCamera: simd_float4x4?
    private var lastProcessed = -Double.infinity
    private var referenceScore: Double?
    private var scanPlan: [String: Any] = [:]
    private var diagnosticRequested = false
    private var centreConfirmed = false
    /// UI receives planner JSON on main queue; never use this callback to select a newer image.
    var onGuidance: (@MainActor (String) -> Void)?
    var onPose: (@MainActor (SIMD3<Float>, String) -> Void)?
    var onSaved: (@MainActor (URL) -> Void)?
    var onOriginChanged: (@MainActor () -> Void)?
    var onCoverage: (@MainActor ([Bool]) -> Void)?
    var onFailure: (@MainActor (String) -> Void)?

    init(archiveRoot: URL, bundledPlanner: String, count: Int = 72) throws {
        self.archiveRoot = archiveRoot
        super.init()
        guard (24...128).contains(count) else { throw CaptureError.invalidConfiguration }
        try queue.sync {
            guard let js = JSContext() else { throw CaptureError.javascriptUnavailable }
            context = js
            js.exceptionHandler = { [weak self] _, _ in self?.bridgeFailure = true }
            js.evaluateScript(bundledPlanner)
            bridge = js.objectForKeyedSubscript("GuidedNative")
            guard !bridgeFailure, bridge != nil, !bridge.isUndefined else { throw CaptureError.javascriptUnavailable }
            bridge.invokeMethod("initialise", withArguments: [count, 180])
            if bridgeFailure { throw CaptureError.javascriptUnavailable }
        }
        session.delegateQueue = queue
        session.delegate = self
    }

    func start() throws {
        guard ARWorldTrackingConfiguration.isSupported else { throw CaptureError.unsupportedDevice }
        // Camera permission belongs to the host UI before this call.
        let configuration = ARWorldTrackingConfiguration()
        configuration.worldAlignment = .gravity
        configuration.isAutoFocusEnabled = true
        if let format = ARWorldTrackingConfiguration.supportedVideoFormats.filter({ $0.framesPerSecond == 30 }).max(by: {
            $0.imageResolution.width * $0.imageResolution.height < $1.imageResolution.width * $1.imageResolution.height
        }) { configuration.videoFormat = format }
        streamFPS = configuration.videoFormat.framesPerSecond
        queue.async { self.invalidateOrigin() }
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    func stop() { session.pause() }

    /// Deliberate hardware diagnostic, never a quality-approved orbit capture.
    func requestDiagnosticFrame() { queue.async { self.diagnosticRequested = true } }

    func setAutomatic(_ enabled: Bool) {
        queue.async {
            if !enabled && self.sweepMode { self.finishSweep() }
            self.automatic = enabled
            self.bridge.invokeMethod("resetQuality", withArguments: [])
            self.referenceScore = nil
        }
    }

    func startSweep(band: Int) {
        queue.async {
            guard self.centreConfirmed else { return }
            if self.sweepMode { self.finishSweep() }
            self.sweepMode = true
            self.bridge.invokeMethod("beginSweep", withArguments: [band])
            self.bridge.invokeMethod("resetQuality", withArguments: [])
            self.referenceScore = nil; self.automatic = true
        }
    }
    private func finishSweep() {
        guard let text = bridge.invokeMethod("finishSweep", withArguments: [])?.toString(),
              let data = text.data(using: .utf8),
              let result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        saveSweepTicket(result)
        publish(bridge.invokeMethod("finishSweep", withArguments: [])?.toString() ?? text)
        publishCoverage()
    }
    private func saveSweepTicket(_ result: [String: Any]) {
        guard let ticket = result["ticket"] as? [String: Any], let token = ticket["token"] as? Int,
              let generation = ticket["generation"] as? Int, let slot = ticket["slot"] as? Int else { return }
        guard let saved = candidate, ticket["frameId"] as? String == saved.id else {
            bridge.invokeMethod("acknowledge", withArguments: [token, generation, false]); return
        }
        candidate = nil
        do {
            let folder = try persist(saved.frame, id: saved.id, slot: slot, generation: generation,
                                     tracking: "normal", quality: saved.quality, framed: true, subjectStill: nil,
                                     purpose: "sweep", headBounds: saved.bounds)
            bridge.invokeMethod("acknowledge", withArguments: [token, generation, true])
            DispatchQueue.main.async { self.onSaved?(folder) }
        } catch {
            bridge.invokeMethod("acknowledge", withArguments: [token, generation, false]); reportSaveFailure(error)
        }
    }

    /// Host must obtain AND confirm a subject-space point; a random raycast plane is insufficient.
    func confirmCentre(_ point: SIMD3<Float>, radiusMetres: Double, count: Int, frontAzimuth: Double) {
        queue.async {
            guard (24...128).contains(count), !self.bridgeFailure,
                  let json = self.json(["centre": [Double(point.x), Double(point.y), Double(point.z)],
                                        "radius": radiusMetres, "segment": self.segment, "frontAzimuth": frontAzimuth]) else { return }
            self.bridge.invokeMethod("initialise", withArguments: [count, 180])
            self.bridge.invokeMethod("resetQuality", withArguments: [])
            self.bridge.invokeMethod("setCentre", withArguments: [json])
            self.centreConfirmed = !self.bridgeFailure
            self.confirmedPoint = point; self.automatic = false; self.referenceScore = nil
            self.candidate = nil; self.sweepMode = false
            self.scanPlan = ["schema": "front-head-capture-plan-v1", "count": count, "arcDegrees": 180,
                             "scanId": UUID().uuidString, "frontAzimuth": frontAzimuth, "radiusMetres": radiusMetres,
                             "centre": [Double(point.x), Double(point.y), Double(point.z)],
                             "elevationsDegrees": [-15, 0, 15], "rearGeometry": "unobserved-template-completion-only",
                             "qualityMethod": "experimental-projected-head-roi-v1", "scaleValidated": false]
            do {
                let folder = self.archiveRoot.appendingPathComponent(self.sessionID).appendingPathComponent(self.segment)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try self.syncedWrite(JSONSerialization.data(withJSONObject: self.scanPlan, options: [.sortedKeys]), to: folder.appendingPathComponent("plan-" + UUID().uuidString + ".json"))
            } catch { self.automatic = false; self.centreConfirmed = false; self.publish("{\"message\":\"Could not save scan plan — confirm centre again\"}") }
        }
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard !bridgeFailure else { publish("{\"message\":\"Capture planner unavailable\"}"); return }
        guard frame.timestamp - lastProcessed >= (sweepMode ? 0.029 : 0.09) else { return }
        let sampleInterval = frame.timestamp-lastProcessed
        lastProcessed = frame.timestamp
        let camera = frame.camera, transform = camera.transform
        let frameID = UUID().uuidString
        let headBounds = sweepMode ? detectHead(frame.capturedImage) : nil
        let samples = sweepMode && headBounds == nil ? nil : sampleHead(frame, bounds: headBounds)
        let cameraStill: Bool
        if let previous = previousCamera {
            cameraStill = sampleInterval > 0 && sampleInterval <= 0.25 &&
                Double(simd_distance(transform.columns.3, previous.columns.3))/sampleInterval < 0.03 &&
                simd_dot(transform.columns.2, previous.columns.2) > cos(Float(sampleInterval)*Float.pi/60)
        } else { cameraStill = false }
        previousCamera = transform
        let qualityInput: [String: Any] = ["timestamp": frame.timestamp, "pixels": samples ?? [], "framed": samples != nil, "cameraStill": cameraStill]
        let qualityJSON = json(qualityInput) ?? "{}"
        let qualityString = bridge.invokeMethod("evaluateQuality", withArguments: [qualityJSON])?.toString() ?? "{}"
        let quality = (qualityString.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any] ?? [:]
        let sharp = quality["sharp"] as? Bool, exposed = quality["exposed"] as? Bool
        let framed = quality["framed"] as? Bool, still = quality["subjectStill"] as? Bool
        referenceScore = quality["reference"] as? Double
        let luma = (quality["sharpnessScore"] as? Double).map {
            LumaQuality(sharpness: $0, dark: quality["darkFraction"] as? Double ?? 1, bright: quality["brightFraction"] as? Double ?? 1)
        }
        let tracking: String
        switch camera.trackingState { case .normal: tracking = "normal"; case .limited: tracking = "limited"; case .notAvailable: tracking = "unavailable" }
        let position = SIMD3<Float>(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
        DispatchQueue.main.async { self.onPose?(position, tracking) }
        if diagnosticRequested {
            diagnosticRequested = false
            if centreConfirmed && tracking == "normal" {
                do {
                    let url = try persist(frame, id: frameID, slot: 0, generation: 1, tracking: tracking,
                                          quality: luma, framed: framed, subjectStill: still,
                                          purpose: "diagnostic")
                    DispatchQueue.main.async { self.onSaved?(url) }
                } catch { reportSaveFailure(error) }
            } else { publish("{\"message\":\"Confirm centre and wait for normal tracking first\"}") }
            // A manual request consumes this frame. Never persist the same frame ID
            // again as an automatic ticket in this callback.
            return
        }
        var input: [String: Any] = [
            "id": frameID, "segment": segment, "timestamp": frame.timestamp,
            "position": [Double(transform.columns.3.x), Double(transform.columns.3.y), Double(transform.columns.3.z)],
            "forward": [-Double(transform.columns.2.x), -Double(transform.columns.2.y), -Double(transform.columns.2.z)],
            "tracking": tracking, "sharp": box(sharp), "exposed": box(exposed),
            "framed": box(framed), "subjectStill": box(still)
        ]
        if automatic && sweepMode {
            input["facePresent"] = headBounds != nil
            input["sharpnessScore"] = luma?.sharpness ?? 0
            input["sharpnessReference"] = referenceScore ?? 0
            guard let text = json(input), let output = bridge.invokeMethod("evaluateSweep", withArguments: [text])?.toString(),
                  let data = output.data(using: .utf8),
                  let result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], !bridgeFailure else { return }
            // Save the OLD exact ARFrame before replacing the one retained candidate.
            saveSweepTicket(result)
            if result["keep"] as? Bool == true { candidate = (frame, frameID, luma, headBounds) }
            if referenceScore == nil {
                publish("{\"message\":\"Calibrating — hold camera and subject still in good light\"}")
            } else { publish(output) }
            publishCoverage()
            return
        }
        guard let inputJSON = json(input),
              let output = bridge.invokeMethod(automatic ? "evaluateFrame" : "evaluateDiagnosticFrame", withArguments: [inputJSON])?.toString(),
              !bridgeFailure,
              let bytes = output.data(using: .utf8),
              let result = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] else { return }
        if automatic && referenceScore == nil && samples != nil && tracking == "normal" {
            publish("{\"message\":\"Calibrating image checks — hold still in good light (\(quality["calibrationFrames"] as? Int ?? 0)/12)\"}")
        } else { publish(output) }
        if let coverageJSON = bridge.invokeMethod("coverage", withArguments: [])?.toString(),
           let data = coverageJSON.data(using: .utf8),
           let values = (try? JSONSerialization.jsonObject(with: data)) as? [Bool] {
            DispatchQueue.main.async { self.onCoverage?(values) }
        }
        guard let ticket = result["ticket"] as? [String: Any],
              let ticketFrame = ticket["frame"] as? [String: Any],
              ticketFrame["id"] as? String == frameID,
              let token = ticket["token"] as? Int,
              let generation = ticket["generation"] as? Int,
              let slot = ticket["slot"] as? Int else { return }
        do {
            // Synchronous serial-queue archive uses THIS callback frame, not session.currentFrame.
            let url = try persist(frame, id: frameID, slot: slot, generation: generation,
                        tracking: tracking, quality: luma, framed: framed, subjectStill: still)
            bridge.invokeMethod("acknowledge", withArguments: [token, generation, true])
            DispatchQueue.main.async { self.onSaved?(url) }
        } catch {
            bridge.invokeMethod("acknowledge", withArguments: [token, generation, false])
            reportSaveFailure(error)
        }
    }

    private func publishCoverage() {
        guard let text = bridge.invokeMethod("coverage", withArguments: [])?.toString(), let data = text.data(using: .utf8),
              let values = (try? JSONSerialization.jsonObject(with: data)) as? [Bool] else { return }
        DispatchQueue.main.async { self.onCoverage?(values) }
    }

    private func reportSaveFailure(_ error: Error) {
        automatic = false
        let message = (error as? CaptureError) == .lowStorage
            ? "Storage is nearly full. Export your scans and free space before continuing."
            : "Photo could not be saved. Earlier photos are retained. Check storage before retrying."
        DispatchQueue.main.async { self.onFailure?(message) }
    }

    func sessionWasInterrupted(_ session: ARSession) { invalidateOrigin() }
    func session(_ session: ARSession, didFailWithError error: Error) { invalidateOrigin() }
    private func invalidateOrigin() {
        segment = UUID().uuidString; centreConfirmed = false; diagnosticRequested = false
        automatic = false; confirmedPoint = nil; previousCamera = nil; lastProcessed = -Double.infinity
        candidate = nil; sweepMode = false
        bridge.invokeMethod("resetQuality", withArguments: [])
        DispatchQueue.main.async { self.onOriginChanged?() }
    }

    private func persist(_ frame: ARFrame, id: String, slot: Int, generation: Int,
                         tracking: String, quality: LumaQuality?, framed: Bool?, subjectStill: Bool?,
                         purpose: String = "guided", headBounds: CGRect? = nil) throws -> URL {
        let fm = FileManager.default
        let capacity = try archiveRoot.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage
        if let capacity, capacity < 100_000_000 { throw CaptureError.lowStorage }
        let parent = archiveRoot.appendingPathComponent(sessionID).appendingPathComponent(segment)
        try fm.createDirectory(at: parent, withIntermediateDirectories: true)
        let staging = parent.appendingPathComponent(".pending-" + id)
        let destination = parent.appendingPathComponent(id)
        try fm.createDirectory(at: staging, withIntermediateDirectories: false)
        var committed = false
        defer { if !committed { try? fm.removeItem(at: staging) } }
        let buffer = frame.capturedImage
        let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
        guard Int(frame.camera.imageResolution.width) == width,
              Int(frame.camera.imageResolution.height) == height else { throw CaptureError.imageGeometryMismatch }
        guard let colourSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let jpeg = imageContext.jpegRepresentation(of: CIImage(cvPixelBuffer: buffer), colorSpace: colourSpace,
                                                        options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.97]) else { throw CaptureError.encodingFailed }
        let k = frame.camera.intrinsics, m = frame.camera.transform
        let metadata: [String: Any] = [
            "schema": "arkit-image-record-v1", "capturePurpose": purpose, "sessionId": sessionID, "segment": segment,
            "frameId": id, "timestamp": frame.timestamp, "slot": slot, "generation": generation,
            "image": ["file": "image.jpg", "width": width, "height": height,
                      "sha256": SHA256.hash(data: jpeg).map { String(format: "%02x", $0) }.joined(),
                      "orientation": "native-buffer", "mirrored": false],
            "cameraToWorld": (0..<4).flatMap { c in (0..<4).map { r in Double(m[c][r]) } },
            "intrinsics": (0..<3).flatMap { c in (0..<3).map { r in Double(k[c][r]) } },
            "matrixOrder": "column-major", "units": "metres", "tracking": tracking,
            "capturePlan": scanPlan, "qualityMethod": purpose == "sweep" ? "experimental-vision-head-sweep-v1" : "experimental-projected-head-roi-v1",
            "headBoundsNative": headBounds.map { [$0.origin.x, $0.origin.y, $0.width, $0.height] as Any } ?? NSNull(),
            "subjectMotionMethod": purpose == "sweep" ? "not-measured-during-camera-motion" : "short-term-photometric",
            "cameraStreamFPS": streamFPS,
            "qualityReference": referenceScore.map { $0 as Any } ?? NSNull(),
            "axes": "arkit-right-handed-y-up-camera-negative-z-forward", "scaleValidated": false,
            "quality": ["sharpnessScore": quality.map { $0.sharpness as Any } ?? NSNull(),
                        "darkFraction": quality.map { $0.dark as Any } ?? NSNull(),
                        "brightFraction": quality.map { $0.bright as Any } ?? NSNull(),
                        "framed": box(framed), "subjectStill": box(subjectStill)]
        ]
        try syncedWrite(jpeg, to: staging.appendingPathComponent("image.jpg"))
        try syncedWrite(JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys]),
                        to: staging.appendingPathComponent("metadata.json"))
        // Rename only after both synchronized files exist. Importers ignore .pending directories.
        try fm.moveItem(at: staging, to: destination)
        committed = true
        return destination
    }

    private func syncedWrite(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: .atomic)
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.synchronize()
    }

    /// Approximate head envelope around the user-confirmed point, in native buffer axes.
    /// This is geometric framing plus photometric stability, not face identity/motion tracking.
    private func sampleHead(_ frame: ARFrame, bounds: CGRect? = nil) -> [Double]? {
        guard let centre = confirmedPoint else { return nil }
        let buffer = frame.capturedImage
        let inverse = simd_inverse(frame.camera.transform), k = frame.camera.intrinsics
        // Project a world-upright box: native buffers remain landscape even when the
        // phone/UI is portrait. Image-axis width/height assumptions would crop the head.
        var xs: [Double] = [], ys: [Double] = []
        for x in [-Float(0.13), Float(0.13)] {
            for y in [-Float(0.18), Float(0.18)] {
                for z in [-Float(0.13), Float(0.13)] {
                    let p = inverse * SIMD4<Float>(centre.x+x, centre.y+y, centre.z+z, 1)
                    let depth = -Double(p.z)
                    guard depth > 0.2 else { return nil }
                    xs.append(Double(k.columns.2.x) + Double(k.columns.0.x)*Double(p.x)/depth)
                    ys.append(Double(k.columns.2.y) - Double(k.columns.1.y)*Double(p.y)/depth)
                }
            }
        }
        guard let left = xs.min(), let right = xs.max(), let top = ys.min(), let bottom = ys.max() else { return nil }
        let cx = bounds.map { Double($0.midX) } ?? (left+right)/2, cy = bounds.map { Double($0.midY) } ?? (top+bottom)/2
        let halfWidth = bounds.map { Double($0.width)/2 } ?? (right-left)/2, halfHeight = bounds.map { Double($0.height)/2 } ?? (bottom-top)/2
        let format = CVPixelBufferGetPixelFormatType(buffer)
        guard format == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange || format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange else { return nil }
        guard CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let raw = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) else { return nil }
        let w = CVPixelBufferGetWidthOfPlane(buffer, 0), h = CVPixelBufferGetHeightOfPlane(buffer, 0)
        let strideBytes = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0), p = raw.assumingMemoryBound(to: UInt8.self)
        guard cx-halfWidth > 8, cx+halfWidth < Double(w)-8,
              cy-halfHeight > 8, cy+halfHeight < Double(h)-8 else { return nil }
        let video = format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        func sample(_ x: Int, _ y: Int) -> Double {
            let v = Double(p[y*strideBytes+x]); return video ? max(0, min(255, (v-16)*255/219)) : v
        }
        var pixels: [Double] = []
        for y in 0..<32 {
            for x in 0..<32 {
                let px = Int(cx-halfWidth + (Double(x)+0.5)*2*halfWidth/32)
                let py = Int(cy-halfHeight + (Double(y)+0.5)*2*halfHeight/32)
                pixels.append(sample(px,py))
            }
        }
        return pixels
    }

    /// Portrait rear camera: Vision upright bbox -> original landscape buffer pixels.
    /// Reject multiple faces and clipped expanded head estimates; never use a stale detection.
    private func detectHead(_ buffer: CVPixelBuffer) -> CGRect? {
        let request = VNDetectFaceRectanglesRequest()
        do { try VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .right).perform([request]) }
        catch { return nil }
        guard let faces = request.results, faces.count == 1, let face = faces.first, face.confidence >= 0.6 else { return nil }
        let box = face.boundingBox
        let expanded = CGRect(x: box.minX-box.width*0.4, y: box.minY-box.height*0.35,
                              width: box.width*1.8, height: box.height*2.0)
        guard expanded.minX > 0.005, expanded.minY > 0.005, expanded.maxX < 0.995, expanded.maxY < 0.995 else { return nil }
        let w = CGFloat(CVPixelBufferGetWidth(buffer)), h = CGFloat(CVPixelBufferGetHeight(buffer))
        return CGRect(x: (1-expanded.maxY)*w, y: (1-expanded.maxX)*h, width: expanded.height*w, height: expanded.width*h)
    }

    /// Serial queue prevents writes while Foundation snapshots all retained sessions.
    func exportArchive(completion: @escaping @MainActor (URL?, String?) -> Void) {
        queue.async {
            if self.sweepMode { self.finishSweep() }
            self.automatic = false
            var coordinationError: NSError?
            var copyError: Error?
            var exported: URL?
            let destination = FileManager.default.temporaryDirectory.appendingPathComponent("HeadScans-" + UUID().uuidString + ".zip")
            NSFileCoordinator().coordinate(readingItemAt: self.archiveRoot, options: .forUploading, error: &coordinationError) { snapshot in
                do { try FileManager.default.copyItem(at: snapshot, to: destination); exported = destination }
                catch { copyError = error }
            }
            let failure: Error? = coordinationError.map { $0 as Error } ?? copyError
            DispatchQueue.main.async { completion(exported, failure?.localizedDescription) }
        }
    }

    private func box(_ value: Bool?) -> Any { value.map { $0 as Any } ?? NSNull() }
    private func json(_ value: [String: Any]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return nil }
        return String(data: data, encoding: .utf8)
    }
    private func publish(_ value: String) { DispatchQueue.main.async { self.onGuidance?(value) } }
    enum CaptureError: Error, Equatable { case invalidConfiguration, javascriptUnavailable, unsupportedDevice, imageGeometryMismatch, encodingFailed, lowStorage }
}

// Experimental App Clip building block. Requires an iOS target and device validation.
import ARKit
import Foundation
import CoreImage
import ImageIO
import CryptoKit
import JavaScriptCore

struct ImageQualityPolicy {
    // Device/lighting dependent; no unvalidated default silently enables capture.
    let minimumLaplacianVariance: Double
    let maximumDarkFraction: Double
    let maximumBrightFraction: Double
}

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
    private var policy: ImageQualityPolicy?
    private var qualityProvider: ((ARFrame) -> (framed: Bool?, subjectStill: Bool?))?
    private var diagnosticRequested = false
    private var centreConfirmed = false
    /// UI receives planner JSON on main queue; never use this callback to select a newer image.
    var onGuidance: (@MainActor (String) -> Void)?
    var onPose: (@MainActor (SIMD3<Float>, String) -> Void)?
    var onSaved: (@MainActor (URL) -> Void)?
    var onOriginChanged: (@MainActor () -> Void)?
    var onCoverage: (@MainActor ([Bool]) -> Void)?

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
            bridge.invokeMethod("initialise", withArguments: [count])
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
        queue.async { self.invalidateOrigin() }
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    func stop() { session.pause() }

    /// Deliberate hardware diagnostic, never a quality-approved orbit capture.
    func requestDiagnosticFrame() { queue.async { self.diagnosticRequested = true } }

    func configureQuality(policy: ImageQualityPolicy?,
                          provider: ((ARFrame) -> (framed: Bool?, subjectStill: Bool?))?) {
        queue.async { self.policy = policy; self.qualityProvider = provider }
    }

    /// Host must obtain AND confirm a subject-space point; a random raycast plane is insufficient.
    func confirmCentre(_ point: SIMD3<Float>, radiusMetres: Double) {
        queue.async {
            guard !self.bridgeFailure,
                  let json = self.json(["centre": [Double(point.x), Double(point.y), Double(point.z)],
                                        "radius": radiusMetres, "segment": self.segment]) else { return }
            self.bridge.invokeMethod("setCentre", withArguments: [json])
            self.centreConfirmed = !self.bridgeFailure
        }
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard !bridgeFailure else { publish("{\"message\":\"Capture planner unavailable\"}"); return }
        let camera = frame.camera, transform = camera.transform
        let frameID = UUID().uuidString
        let luma = measureLuma(frame.capturedImage)
        let checks = qualityProvider?(frame)
        let sharp: Bool? = policy.flatMap { p in luma.map { $0.sharpness >= p.minimumLaplacianVariance } }
        let exposed: Bool? = policy.flatMap { p in luma.map { $0.dark <= p.maximumDarkFraction && $0.bright <= p.maximumBrightFraction } }
        let tracking: String
        switch camera.trackingState { case .normal: tracking = "normal"; case .limited: tracking = "limited"; case .notAvailable: tracking = "unavailable" }
        let position = SIMD3<Float>(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
        DispatchQueue.main.async { self.onPose?(position, tracking) }
        if diagnosticRequested {
            diagnosticRequested = false
            if centreConfirmed && tracking == "normal" {
                do {
                    let url = try persist(frame, id: frameID, slot: 0, generation: 1, tracking: tracking,
                                          quality: luma, framed: checks?.framed, subjectStill: checks?.subjectStill,
                                          purpose: "diagnostic")
                    DispatchQueue.main.async { self.onSaved?(url) }
                } catch { publish("{\"message\":\"Diagnostic save failed\"}") }
            } else { publish("{\"message\":\"Confirm centre and wait for normal tracking first\"}") }
        }
        let input: [String: Any] = [
            "id": frameID, "segment": segment, "timestamp": frame.timestamp,
            "position": [Double(transform.columns.3.x), Double(transform.columns.3.y), Double(transform.columns.3.z)],
            "forward": [-Double(transform.columns.2.x), -Double(transform.columns.2.y), -Double(transform.columns.2.z)],
            "tracking": tracking, "sharp": box(sharp), "exposed": box(exposed),
            "framed": box(checks?.framed), "subjectStill": box(checks?.subjectStill)
        ]
        guard let inputJSON = json(input),
              let output = bridge.invokeMethod(policy == nil || qualityProvider == nil ? "evaluateDiagnosticFrame" : "evaluateFrame", withArguments: [inputJSON])?.toString(),
              !bridgeFailure,
              let bytes = output.data(using: .utf8),
              let result = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] else { return }
        publish(output)
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
                        tracking: tracking, quality: luma, framed: checks?.framed, subjectStill: checks?.subjectStill)
            bridge.invokeMethod("acknowledge", withArguments: [token, generation, true])
            DispatchQueue.main.async { self.onSaved?(url) }
        } catch {
            bridge.invokeMethod("acknowledge", withArguments: [token, generation, false])
            publish("{\"message\":\"Photo could not be saved — hold position to retry\"}")
        }
    }

    func sessionWasInterrupted(_ session: ARSession) { invalidateOrigin() }
    func session(_ session: ARSession, didFailWithError error: Error) { invalidateOrigin() }
    private func invalidateOrigin() {
        segment = UUID().uuidString; centreConfirmed = false; diagnosticRequested = false
        DispatchQueue.main.async { self.onOriginChanged?() }
    }

    private func persist(_ frame: ARFrame, id: String, slot: Int, generation: Int,
                         tracking: String, quality: LumaQuality?, framed: Bool?, subjectStill: Bool?,
                         purpose: String = "guided") throws -> URL {
        let fm = FileManager.default
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

    private func measureLuma(_ buffer: CVPixelBuffer) -> LumaQuality? {
        let format = CVPixelBufferGetPixelFormatType(buffer)
        guard format == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange || format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange else { return nil }
        guard CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let raw = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) else { return nil }
        let w = CVPixelBufferGetWidthOfPlane(buffer, 0), h = CVPixelBufferGetHeightOfPlane(buffer, 0)
        let strideBytes = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0), p = raw.assumingMemoryBound(to: UInt8.self)
        let step = 4
        guard w > step*2, h > step*2 else { return nil }
        let video = format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        func sample(_ x: Int, _ y: Int) -> Double {
            let v = Double(p[y*strideBytes+x]); return video ? max(0, min(255, (v-16)*255/219)) : v
        }
        var count = 0.0, sum = 0.0, squares = 0.0, dark = 0.0, bright = 0.0
        for y in Swift.stride(from: step, to: h-step, by: step) {
            for x in Swift.stride(from: step, to: w-step, by: step) {
                let v = sample(x,y), lap = sample(x-step,y)+sample(x+step,y)+sample(x,y-step)+sample(x,y+step)-4*v
                count += 1; sum += lap; squares += lap*lap
                if v < 8 { dark += 1 }; if v > 247 { bright += 1 }
            }
        }
        return LumaQuality(sharpness: max(0, squares/count - pow(sum/count,2)), dark: dark/count, bright: bright/count)
    }

    private func box(_ value: Bool?) -> Any { value.map { $0 as Any } ?? NSNull() }
    private func json(_ value: [String: Any]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return nil }
        return String(data: data, encoding: .utf8)
    }
    private func publish(_ value: String) { DispatchQueue.main.async { self.onGuidance?(value) } }
    enum CaptureError: Error { case invalidConfiguration, javascriptUnavailable, unsupportedDevice, imageGeometryMismatch, encodingFailed }
}

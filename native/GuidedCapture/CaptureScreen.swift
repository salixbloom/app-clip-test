import SwiftUI
import ARKit
import SceneKit
import AVFoundation

@MainActor
final class CaptureScreenModel: ObservableObject {
    @Published var message = "Start camera to begin"
    @Published var tracking = "unavailable"
    @Published var position = SIMD3<Float>.zero
    @Published var centre: SIMD3<Float>?
    @Published var candidate: SIMD3<Float>?
    @Published var estimatedDistance = 1.0
    @Published var savedFiles: [URL] = []
    @Published var savedCount = 0
    @Published var coverage = Array(repeating: false, count: 72)
    @Published var nextSlot: Int?
    @Published var running = false
    var controller: ARKitCaptureController?
    weak var preview: ARSCNView?
    private var ray: (origin: SIMD3<Float>, direction: SIMD3<Float>)?
    private let marker = SCNNode(geometry: SCNSphere(radius: 0.012))

    init() {
        do {
            guard let resource = Bundle.main.url(forResource: "GuidedNative", withExtension: "js") else {
                message = "Planner resource missing from build"; return
            }
            let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                   appropriateFor: nil, create: true).appendingPathComponent("Captures")
            let native = try ARKitCaptureController(archiveRoot: root, bundledPlanner: String(contentsOf: resource, encoding: .utf8))
            controller = native
            native.onGuidance = { [weak self] text in
                guard let data = text.data(using: .utf8), let v = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
                self?.message = v["message"] as? String ?? "Waiting for camera"
                self?.nextSlot = (v["next"] as? [String: Any])?["id"] as? Int
            }
            native.onPose = { [weak self] p, tracking in self?.position = p; self?.tracking = tracking }
            native.onCoverage = { [weak self] values in self?.coverage = values }
            native.onOriginChanged = { [weak self] in
                self?.centre = nil; self?.candidate = nil; self?.ray = nil
                self?.marker.removeFromParentNode()
                self?.message = "Tracking restarted — set scan centre again"
            }
            native.onSaved = { [weak self] folder in
                self?.savedFiles = [folder.appendingPathComponent("image.jpg"), folder.appendingPathComponent("metadata.json")]
                self?.savedCount += 1
            }
            marker.geometry?.firstMaterial?.diffuse.contents = UIColor.systemYellow
        } catch { message = "Capture setup failed: \(error.localizedDescription)" }
    }

    func start() async {
        guard !running, let controller else { return }
        let allowed = await AVCaptureDevice.requestAccess(for: .video)
        guard allowed else { message = "Camera permission is needed. Enable it in Settings to continue."; return }
        do { try controller.start(); running = true } catch { message = "AR tracking unavailable on this device" }
    }
    func pause() { controller?.stop(); running = false; centre = nil; candidate = nil; marker.removeFromParentNode() }

    func tap(_ point: CGPoint) {
        guard let view = preview, let frame = controller?.session.currentFrame, tracking == "normal" else {
            message = "Wait for normal tracking before setting centre"; return
        }
        let t = frame.camera.transform
        let origin = SIMD3<Float>(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        // SceneKit unprojects viewport coordinates, including camera display orientation.
        let far = view.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 1))
        let delta = SIMD3<Float>(far.x, far.y, far.z) - origin
        guard simd_length(delta) > 0.001 else { return }
        ray = (origin, simd_normalize(delta))
        centre = nil
        updateCandidate()
        message = "Check the yellow point and estimated camera-to-head distance, then confirm"
    }
    func updateCandidate() {
        guard let ray, let view = preview else { return }
        let p = ray.origin + Float(estimatedDistance) * ray.direction
        candidate = p; marker.simdPosition = p
        if marker.parent == nil { view.scene.rootNode.addChildNode(marker) }
    }
    func confirm() {
        guard let p = candidate, tracking == "normal" else { return }
        let radius = Double(simd_distance(position, p))
        guard (0.5...1.5).contains(radius) else { message = "Move to 0.5–1.5 metres before confirming"; return }
        controller?.confirmCentre(p, radiusMetres: radius)
        centre = p; coverage = Array(repeating: false, count: 72)
    }
}

@MainActor struct CameraPreview: UIViewRepresentable {
    @ObservedObject var model: CaptureScreenModel
    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        view.scene = SCNScene()
        if let session = model.controller?.session { view.session = session }
        view.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tap(_:))))
        model.preview = view
        return view
    }
    func updateUIView(_ uiView: ARSCNView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(model) }
    @MainActor final class Coordinator: NSObject {
        let model: CaptureScreenModel
        init(_ model: CaptureScreenModel) { self.model = model }
        @objc func tap(_ recognizer: UITapGestureRecognizer) { model.tap(recognizer.location(in: recognizer.view)) }
    }
}

@MainActor struct OrbitInset: View {
    @ObservedObject var model: CaptureScreenModel
    var body: some View {
        Canvas { context, size in
            func project(_ p: SIMD3<Float>) -> CGPoint {
                CGPoint(x: size.width/2 + CGFloat(p.x - 0.45*p.z)*60,
                        y: size.height/2 - CGFloat(p.y + 0.32*p.z)*60)
            }
            for i in 0..<72 {
                let a = Float(i % 24) * 2 * .pi / 24, e = Float(i / 24 - 1) * .pi / 12
                let p = project(SIMD3<Float>(sin(a)*cos(e), sin(e), cos(a)*cos(e)))
                let colour: Color = model.coverage.indices.contains(i) && model.coverage[i] ? .green : model.nextSlot == i ? .yellow : .gray
                context.fill(Path(ellipseIn: CGRect(x:p.x-2,y:p.y-2,width:4,height:4)), with: .color(colour))
            }
            let centre = CGPoint(x:size.width/2,y:size.height/2)
            context.fill(Path(ellipseIn: CGRect(x:centre.x-6,y:centre.y-10,width:12,height:20)), with: .color(.white))
            if let target = model.centre {
                let p = project(model.position-target)
                context.fill(Path(CGRect(x:p.x-4,y:p.y-6,width:8,height:12)), with: .color(.cyan))
            }
        }.frame(width:180,height:140).background(.black.opacity(0.75)).clipShape(RoundedRectangle(cornerRadius:12))
    }
}

@MainActor struct CaptureScreen: View {
    @StateObject private var model = CaptureScreenModel()
    @Environment(\.scenePhase) private var phase
    @State private var sharing = false
    var body: some View {
        ZStack {
            CameraPreview(model:model).ignoresSafeArea()
            VStack {
                HStack(alignment:.top) {
                    VStack(alignment:.leading) {
                        Text("Capture test").font(.headline)
                        Text("Tracking: \(model.tracking)")
                        Text("Manual capture · automatic checks are not active").font(.caption)
                    }.padding().background(.black.opacity(0.75)).cornerRadius(12)
                    Spacer()
                    OrbitInset(model:model)
                }
                Spacer()
                VStack(spacing:10) {
                    Text(model.message).font(.headline)
                    if model.centre == nil {
                        Text("Tap the head. Set approximate distance; the tap does not measure depth.").font(.caption)
                        Text("Estimated distance: \(model.estimatedDistance, specifier:"%.2f") m")
                        Slider(value:$model.estimatedDistance,in:0.5...1.5,step:0.01).onChange(of:model.estimatedDistance) { _ in model.updateCandidate() }
                        Button("Confirm scan centre") { model.confirm() }.disabled(model.candidate == nil || model.tracking != "normal")
                    }
                    HStack {
                        Button("Take photo") { model.controller?.requestDiagnosticFrame() }
                            .disabled(model.centre == nil || model.tracking != "normal")
                        if !model.savedFiles.isEmpty { Button("Share saved pair") { sharing = true } }
                    }
                    Text("\(model.savedCount) photos saved on this iPhone. Manual photos do not fill the automatic capture markers.").font(.caption)
                }.padding().background(.black.opacity(0.85)).cornerRadius(14)
            }.padding().foregroundColor(.white).buttonStyle(.borderedProminent)
        }
        .task { await model.start() }
        .onChange(of:phase) { value in if value == .active { Task { await model.start() } } else { model.pause() } }
        .sheet(isPresented:$sharing) { SharePair(files:model.savedFiles) }
    }
}

struct SharePair: UIViewControllerRepresentable {
    let files:[URL]
    func makeUIViewController(context:Context) -> UIActivityViewController { UIActivityViewController(activityItems:files,applicationActivities:nil) }
    func updateUIViewController(_ uiViewController:UIActivityViewController,context:Context) {}
}

@main @MainActor struct GuidedCaptureApp: App { var body: some Scene { WindowGroup { CaptureScreen() } } }

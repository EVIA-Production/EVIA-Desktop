// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "SystemAudioCapture",
    platforms: [
        .macOS(.v12)
    ],
    products: [
        .executable(name: "SystemAudioCapture", targets: ["SystemAudioCapture"]),
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "SystemAudioCapture",
            dependencies: []
        ),
    ]
)
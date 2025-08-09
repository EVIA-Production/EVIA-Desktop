// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "SystemAudioCapture",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "SystemAudioCapture", targets: ["SystemAudioCapture"]),
    ],
    targets: [
        .executableTarget(
            name: "SystemAudioCapture",
            path: "Sources"
        )
    ]
)



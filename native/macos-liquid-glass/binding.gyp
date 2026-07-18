{
  "targets": [
    {
      "target_name": "taylos_liquid_glass",
      "sources": ["src/taylos_liquid_glass.mm"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "link_settings": {
              "libraries": [
                "-framework AppKit",
                "-framework QuartzCore"
              ]
            },
            "xcode_settings": {
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "MACOSX_DEPLOYMENT_TARGET": "11.0",
              "OTHER_CPLUSPLUSFLAGS": ["-std=c++17"]
            }
          }
        ]
      ]
    }
  ]
}

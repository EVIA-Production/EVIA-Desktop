{
  "targets": [
    {
      "target_name": "taylos_windows_glass",
      "sources": ["src/taylos_windows_glass.cpp"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NOMINMAX",
        "WIN32_LEAN_AND_MEAN"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": [
              "d2d1.lib",
              "dwmapi.lib",
              "dxguid.lib",
              "runtimeobject.lib",
              "windowsapp.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1
              }
            }
          }
        ]
      ]
    }
  ]
}

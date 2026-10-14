#include <napi.h>

#include <DispatcherQueue.h>
#include <dwmapi.h>
#include <windows.h>
#include <windows.ui.composition.interop.h>
#include <winrt/Windows.Foundation.Numerics.h>
#include <winrt/Windows.Graphics.Effects.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.UI.h>
#include <winrt/Windows.UI.Composition.Desktop.h>
#include <winrt/Windows.UI.Composition.h>
#include <winrt/base.h>
#include <wrl/client.h>

#include "../third_party/microsoft/microsoft.ui.composition.effects_impl.h"

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

constexpr DWORD kDwmUseHostBackdropBrush = 17;
constexpr DWORD kDwmBorderColor = 34;
constexpr COLORREF kDwmColorNone = 0xFFFFFFFE;

struct BackdropLayer {
  winrt::Windows::UI::Composition::SpriteVisual visual{nullptr};
  winrt::Windows::UI::Composition::CompositionEffectBrush effect{nullptr};
  winrt::Windows::UI::Composition::CompositionRoundedRectangleGeometry geometry{nullptr};
  winrt::Windows::UI::Composition::CompositionGeometricClip clip{nullptr};
  float logical_inset = 0.0f;
};

struct GlassState {
  winrt::Windows::UI::Composition::Compositor compositor{nullptr};
  winrt::Windows::UI::Composition::Desktop::DesktopWindowTarget target{nullptr};
  winrt::Windows::UI::Composition::ContainerVisual root{nullptr};
  std::vector<BackdropLayer> backdrop_layers;
  winrt::Windows::UI::Composition::SpriteVisual tint{nullptr};
  winrt::Windows::UI::Composition::CompositionRoundedRectangleGeometry geometry{nullptr};
  winrt::Windows::UI::Composition::CompositionGeometricClip clip{nullptr};
  bool visible = false;
};

std::mutex g_states_mutex;
std::unordered_map<HWND, std::unique_ptr<GlassState>> g_states;
winrt::Windows::System::DispatcherQueueController g_dispatcher_queue{nullptr};

void Trace(const char* message) {
  if (!GetEnvironmentVariableW(L"TAYLOS_GLASS_TRACE", nullptr, 0)) return;
  wchar_t temp_path[MAX_PATH]{};
  if (!GetTempPathW(MAX_PATH, temp_path)) return;
  std::wstring path(temp_path);
  path += L"taylos-windows-glass-native.log";
  const HANDLE file = CreateFileW(
    path.c_str(),
    FILE_APPEND_DATA,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    nullptr,
    OPEN_ALWAYS,
    FILE_ATTRIBUTE_NORMAL,
    nullptr);
  if (file == INVALID_HANDLE_VALUE) return;
  DWORD written = 0;
  WriteFile(file, message, static_cast<DWORD>(std::strlen(message)), &written, nullptr);
  WriteFile(file, "\r\n", 2, &written, nullptr);
  FlushFileBuffers(file);
  CloseHandle(file);
}

// Diagnostics only (TAYLOS_GLASS_TRACE): name the module, offset and unwound
// stack of any exception that would end the process.
std::string DescribeAddress(DWORD64 address) {
  HMODULE module = nullptr;
  char buffer[400];
  if (GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                         reinterpret_cast<LPCSTR>(address), &module) && module) {
    char path[MAX_PATH]{};
    GetModuleFileNameA(module, path, MAX_PATH);
    const char* name = std::strrchr(path, '\\');
    std::snprintf(buffer, sizeof(buffer), "%s+0x%llx", name ? name + 1 : path,
                  static_cast<unsigned long long>(address - reinterpret_cast<DWORD64>(module)));
  } else {
    std::snprintf(buffer, sizeof(buffer), "0x%llx", static_cast<unsigned long long>(address));
  }
  return buffer;
}

thread_local bool g_in_exception_trace = false;

LONG CALLBACK FatalExceptionTrace(EXCEPTION_POINTERS* info) {
  const DWORD code = info->ExceptionRecord->ExceptionCode;
  const bool interesting = code == EXCEPTION_ACCESS_VIOLATION || code == EXCEPTION_ILLEGAL_INSTRUCTION ||
    code == EXCEPTION_BREAKPOINT || code == EXCEPTION_STACK_OVERFLOW || code == EXCEPTION_INT_DIVIDE_BY_ZERO ||
    code == EXCEPTION_PRIV_INSTRUCTION || code == 0xC0000409 || code == 0xC0000374 || code == 0xE06D7363 ||
    code == 0xC000041D || code == 0x80000003;
  if (!interesting || g_in_exception_trace) return EXCEPTION_CONTINUE_SEARCH;
  static std::atomic<int> count{0};
  if (count.fetch_add(1) > 40) return EXCEPTION_CONTINUE_SEARCH;
  g_in_exception_trace = true;
  char line[600];
  std::snprintf(line, sizeof(line), "EXCEPTION code=0x%08lx thread=%lu at %s", code, GetCurrentThreadId(),
                DescribeAddress(reinterpret_cast<DWORD64>(info->ExceptionRecord->ExceptionAddress)).c_str());
  Trace(line);
  if (code == EXCEPTION_ACCESS_VIOLATION && info->ExceptionRecord->NumberParameters >= 2) {
    std::snprintf(line, sizeof(line), "  %s 0x%llx",
                  info->ExceptionRecord->ExceptionInformation[0] == 0 ? "read" : info->ExceptionRecord->ExceptionInformation[0] == 1 ? "write" : "execute",
                  static_cast<unsigned long long>(info->ExceptionRecord->ExceptionInformation[1]));
    Trace(line);
  }
#if defined(_M_X64)
  CONTEXT context = *info->ContextRecord;
  for (int frame = 0; frame < 40 && context.Rip; ++frame) {
    std::snprintf(line, sizeof(line), "  #%d %s", frame, DescribeAddress(context.Rip).c_str());
    Trace(line);
    DWORD64 image_base = 0;
    PRUNTIME_FUNCTION function = RtlLookupFunctionEntry(context.Rip, &image_base, nullptr);
    if (!function) {
      if (IsBadReadPtr(reinterpret_cast<const void*>(context.Rsp), 8)) break;
      context.Rip = *reinterpret_cast<DWORD64*>(context.Rsp);
      context.Rsp += 8;
    } else {
      PVOID handler_data = nullptr;
      DWORD64 establisher = 0;
      RtlVirtualUnwind(UNW_FLAG_NHANDLER, image_base, context.Rip, function, &context, &handler_data, &establisher, nullptr);
    }
  }
#endif
  g_in_exception_trace = false;
  return EXCEPTION_CONTINUE_SEARCH;
}

Napi::Object Result(Napi::Env env, bool supported, bool applied, const std::string& reason = {}) {
  Napi::Object result = Napi::Object::New(env);
  result.Set("supported", Napi::Boolean::New(env, supported));
  result.Set("applied", Napi::Boolean::New(env, applied));
  if (!reason.empty()) result.Set("reason", Napi::String::New(env, reason));
  return result;
}

HWND WindowFromHandle(const Napi::Value& value) {
  if (!value.IsBuffer()) return nullptr;
  const auto buffer = value.As<Napi::Buffer<std::uint8_t>>();
  if (buffer.Length() < sizeof(void*)) return nullptr;
  void* pointer = nullptr;
  std::memcpy(&pointer, buffer.Data(), sizeof(pointer));
  return static_cast<HWND>(pointer);
}

bool RuntimeSupportsGlass() {
  const auto build = [] {
    using RtlGetVersion = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
    const auto ntdll = GetModuleHandleW(L"ntdll.dll");
    const auto rtl_get_version = ntdll
      ? reinterpret_cast<RtlGetVersion>(GetProcAddress(ntdll, "RtlGetVersion"))
      : nullptr;
    RTL_OSVERSIONINFOW version{};
    version.dwOSVersionInfoSize = sizeof(version);
    return rtl_get_version && rtl_get_version(&version) == 0 ? version.dwBuildNumber : 0UL;
  }();
  return build >= 22000;
}

void EnsureDispatcherQueue() {
  if (winrt::Windows::System::DispatcherQueue::GetForCurrentThread()) return;

  DispatcherQueueOptions options{
    sizeof(DispatcherQueueOptions),
    DQTYPE_THREAD_CURRENT,
    DQTAT_COM_STA,
  };
  winrt::Windows::System::DispatcherQueueController controller{nullptr};
  winrt::check_hresult(CreateDispatcherQueueController(
    options,
    reinterpret_cast<ABI::Windows::System::IDispatcherQueueController**>(winrt::put_abi(controller))));
  g_dispatcher_queue = controller;
}

winrt::Windows::UI::Composition::Desktop::DesktopWindowTarget CreateTarget(
  const winrt::Windows::UI::Composition::Compositor& compositor,
  HWND hwnd) {
  namespace abi = ABI::Windows::UI::Composition::Desktop;
  auto interop = compositor.as<abi::ICompositorDesktopInterop>();
  winrt::Windows::UI::Composition::Desktop::DesktopWindowTarget target{nullptr};
  winrt::check_hresult(interop->CreateDesktopWindowTarget(
    hwnd,
    FALSE,
    reinterpret_cast<abi::IDesktopWindowTarget**>(winrt::put_abi(target))));
  return target;
}

winrt::Windows::UI::Composition::CompositionEffectBrush CreateBackdropEffect(
  const winrt::Windows::UI::Composition::Compositor& compositor,
  float blur_amount) {
  using Microsoft::UI::Composition::Effects::EffectBorderMode_Hard;
  using Microsoft::UI::Composition::Effects::EffectOptimization_Balanced;
  using Microsoft::UI::Composition::Effects::GaussianBlurEffect;

  auto blur = Microsoft::WRL::Make<GaussianBlurEffect>();
  winrt::check_hresult(blur->put_BlurAmount(std::clamp(blur_amount, 0.0f, 250.0f)));
  winrt::check_hresult(blur->put_BorderMode(EffectBorderMode_Hard));
  winrt::check_hresult(blur->put_Optimization(EffectOptimization_Balanced));

  const auto source_parameter =
    winrt::Windows::UI::Composition::CompositionEffectSourceParameter(L"backdrop");
  const auto source =
    source_parameter.as<ABI::Windows::Graphics::Effects::IGraphicsEffectSource>();
  winrt::check_hresult(blur->put_Source(source.get()));

  Microsoft::WRL::ComPtr<ABI::Windows::Graphics::Effects::IGraphicsEffect> effect_abi;
  winrt::check_hresult(blur.As(&effect_abi));
  const winrt::Windows::Graphics::Effects::IGraphicsEffect effect{
    effect_abi.Detach(),
    winrt::take_ownership_from_abi,
  };
  auto brush = compositor.CreateEffectFactory(effect).CreateBrush();
  brush.SetSourceParameter(L"backdrop", compositor.CreateHostBackdropBrush());
  return brush;
}

float DpiScale(HWND hwnd) {
  using GetDpiForWindowFn = UINT(WINAPI*)(HWND);
  const auto user32 = GetModuleHandleW(L"user32.dll");
  const auto get_dpi = user32
    ? reinterpret_cast<GetDpiForWindowFn>(GetProcAddress(user32, "GetDpiForWindow"))
    : nullptr;
  const UINT dpi = get_dpi ? get_dpi(hwnd) : 96;
  return static_cast<float>(dpi) / 96.0f;
}

void SynchronizeGeometry(
  HWND hwnd,
  GlassState& state,
  double logical_radius,
  double logical_width,
  double logical_height) {
  RECT client{};
  winrt::check_bool(GetClientRect(hwnd, &client));
  const float client_width = static_cast<float>(std::max<LONG>(1, client.right - client.left));
  const float client_height = static_cast<float>(std::max<LONG>(1, client.bottom - client.top));
  const float dpi_scale = DpiScale(hwnd);
  const float requested_width = logical_width > 0.0
    ? static_cast<float>(logical_width) * dpi_scale
    : client_width;
  const float requested_height = logical_height > 0.0
    ? static_cast<float>(logical_height) * dpi_scale
    : client_height;
  const float width = std::min(client_width, std::max(1.0f, requested_width));
  const float height = std::min(client_height, std::max(1.0f, requested_height));
  const float radius = std::min(
    static_cast<float>(std::max(0.0, logical_radius)) * dpi_scale,
    std::min(width, height) * 0.5f);

  state.geometry.Size({width, height});
  state.geometry.CornerRadius({radius, radius});

  // Tahoe's edge is not a painted vignette. The material refracts the live
  // scene more strongly at the perimeter, then settles toward the center.
  // Each nested HostBackdrop visual covers the previous one, leaving a narrow
  // rounded band of progressively stronger blur visible outside it.
  const float maximum_inset = std::max(0.0f, std::min(width, height) * 0.5f - 1.0f);
  for (auto& layer : state.backdrop_layers) {
    const float inset = std::min(layer.logical_inset * dpi_scale, maximum_inset);
    const float layer_width = std::max(1.0f, width - inset * 2.0f);
    const float layer_height = std::max(1.0f, height - inset * 2.0f);
    const float layer_radius = std::max(0.0f, radius - inset);
    layer.visual.Offset({inset, inset, 0.0f});
    layer.visual.Size({layer_width, layer_height});
    layer.geometry.Size({layer_width, layer_height});
    layer.geometry.CornerRadius({layer_radius, layer_radius});
  }

  // Windows enforces a 64px client area on this 49px frameless Electron
  // window. Shape the visible and hit-test region to the intended material;
  // otherwise the host backdrop paints the surplus as a blurred shelf.
  const int region_width = std::max(1, static_cast<int>(std::ceil(width)));
  const int region_height = std::max(1, static_cast<int>(std::ceil(height)));
  const int region_diameter = std::max(1, static_cast<int>(std::ceil(radius * 2.0f)));
  const HRGN region = CreateRoundRectRgn(
    0,
    0,
    region_width + 1,
    region_height + 1,
    region_diameter,
    region_diameter);
  if (!region) winrt::throw_last_error();
  // Focus updates must not repeatedly dispatch WM_SIZE/WM_WINDOWPOSCHANGED
  // for an unchanged shape. Still repair a region reset by Electron on reveal.
  const HRGN current_region = CreateRectRgn(0, 0, 0, 0);
  if (current_region) {
    const int kind = GetWindowRgn(hwnd, current_region);
    const bool unchanged = kind != ERROR && EqualRgn(current_region, region);
    DeleteObject(current_region);
    if (unchanged) {
      DeleteObject(region);
      return;
    }
  }
  if (!SetWindowRgn(hwnd, region, TRUE)) {
    DeleteObject(region);
    winrt::throw_last_error();
  }
}

void SynchronizeActiveState(GlassState& state, bool active) {
  // AppKit's NSGlassEffectView uses 1.00 while active and 0.94 while inactive.
  // Apply that recession only to the sampled material; Chromium content keeps
  // full contrast while more of the real desktop becomes visible underneath.
  const float material_opacity = active ? 1.0f : 0.94f;
  for (auto& layer : state.backdrop_layers) layer.visual.Opacity(material_opacity);
  state.tint.Opacity(material_opacity);
}

void SynchronizeVisibility(HWND hwnd, GlassState& state, bool visible) {
  // The DesktopWindowTarget is composed independently from Chromium's surface,
  // so BrowserWindow opacity alone cannot make a first reveal atomic.
  const bool revealing = visible && !state.visible;
  state.root.Opacity(visible ? 1.0f : 0.0f);
  state.visible = visible;
  // Chromium's invalidate() does not invalidate the HWND's retained update
  // region. Request the complete client/child surfaces after the product clip
  // is repaired, not just the last damaged corner of a restored layered window.
  if (revealing && IsWindowVisible(hwnd)) {
    Trace("visible: full HWND redraw");
    winrt::check_bool(RedrawWindow(
      hwnd, nullptr, nullptr,
      RDW_INVALIDATE | RDW_FRAME | RDW_ALLCHILDREN | RDW_UPDATENOW));
  }
}

// SetWindowRgn (and other window calls below) synchronously dispatch window
// messages. Electron turns some of them into JavaScript events whose handlers
// call back into this module on the same thread, while the outer call still
// holds g_states_mutex. MSVC's std::mutex then throws "resource deadlock would
// occur"; that C++ exception escaped into V8 and ended the whole app
// (installed 1.0.124, exit 0xFFFF7003, the onboarding product windows' resize
// handler). A nested call is skipped instead: the outer call finishes with the
// current geometry, and a later update applies anything newer.
thread_local int g_bridge_depth = 0;

struct BridgeCall {
  BridgeCall() { ++g_bridge_depth; }
  ~BridgeCall() { --g_bridge_depth; }
  BridgeCall(const BridgeCall&) = delete;
  BridgeCall& operator=(const BridgeCall&) = delete;
  static bool Nested() { return g_bridge_depth > 0; }
};

Napi::Value IsSupported(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), RuntimeSupportsGlass());
}

Napi::Value IsKeyPressed(const Napi::CallbackInfo& info) {
  const Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    return Napi::Boolean::New(env, false);
  }
  const int key_code = info[0].As<Napi::Number>().Int32Value();
  if (key_code < 0 || key_code > 0xFF) return Napi::Boolean::New(env, false);
  return Napi::Boolean::New(env, (GetAsyncKeyState(key_code) & 0x8000) != 0);
}

Napi::Value IsMouseButtonPressed(const Napi::CallbackInfo& info) {
  const Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    return Napi::Boolean::New(env, false);
  }
  const int button = info[0].As<Napi::Number>().Int32Value();
  const int virtual_key = button == 0
    ? VK_LBUTTON
    : button == 1
      ? VK_RBUTTON
      : button == 2
        ? VK_MBUTTON
        : 0;
  if (virtual_key == 0) return Napi::Boolean::New(env, false);
  const SHORT state = GetAsyncKeyState(virtual_key);
  return Napi::Boolean::New(env, (state & 0x8001) != 0);
}

Napi::Value IsCharacterChordPressed(const Napi::CallbackInfo& info) {
  const Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    return Napi::Boolean::New(env, false);
  }

  const std::u16string characters = info[0].As<Napi::String>().Utf16Value();
  if (characters.size() != 1) return Napi::Boolean::New(env, false);

  // Resolve the character through the active keyboard layout on every read.
  // German '#' is an unshifted OEM key; US '#' is Shift+3. VkKeyScanExW
  // preserves that distinction instead of imposing US accelerator semantics.
  const HKL layout = GetKeyboardLayout(0);
  const SHORT translated = VkKeyScanExW(static_cast<WCHAR>(characters[0]), layout);
  if (translated == -1) return Napi::Boolean::New(env, false);

  const int key_code = LOBYTE(translated);
  const int required_modifiers = HIBYTE(translated);
  const bool require_control = info.Length() > 1 && info[1].IsBoolean()
    ? info[1].As<Napi::Boolean>().Value()
    : true;
  const auto pressed = [](int key) {
    return (GetAsyncKeyState(key) & 0x8000) != 0;
  };

  const bool key_pressed = pressed(key_code);
  const bool shift_matches = (required_modifiers & 1) == 0 || pressed(VK_SHIFT);
  const bool control_matches =
    (!require_control && (required_modifiers & 2) == 0) || pressed(VK_CONTROL);
  const bool alt_matches = (required_modifiers & 4) == 0 || pressed(VK_MENU);
  return Napi::Boolean::New(
    env,
    key_pressed && shift_matches && control_matches && alt_matches);
}

Napi::Value Apply(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!RuntimeSupportsGlass()) return Result(env, false, false, "Windows Composition glass is unavailable");
  if (info.Length() < 2 || !info[1].IsObject()) return Result(env, true, false, "invalid arguments");

  const HWND hwnd = WindowFromHandle(info[0]);
  if (!hwnd || !IsWindow(hwnd)) return Result(env, true, false, "native window handle is invalid");

  const Napi::Object options = info[1].As<Napi::Object>();
  const double radius = options.Has("radius") ? options.Get("radius").As<Napi::Number>().DoubleValue() : 18.0;
  const double tint_opacity = options.Has("tintOpacity")
    ? options.Get("tintOpacity").As<Napi::Number>().DoubleValue()
    : 0.0;
  const double blur_amount = options.Has("blurAmount")
    ? options.Get("blurAmount").As<Napi::Number>().DoubleValue()
    : 24.0;
  const double material_width = options.Has("materialWidth")
    ? options.Get("materialWidth").As<Napi::Number>().DoubleValue()
    : 0.0;
  const double material_height = options.Has("materialHeight")
    ? options.Get("materialHeight").As<Napi::Number>().DoubleValue()
    : 0.0;
  const bool active = options.Has("active")
    ? options.Get("active").As<Napi::Boolean>().Value()
    : true;
  const bool visible = options.Has("visible")
    ? options.Get("visible").As<Napi::Boolean>().Value()
    : true;

  if (BridgeCall::Nested()) return Result(env, true, false, "nested call skipped");
  BridgeCall call;
  try {
    Trace("apply: lock");
    std::scoped_lock lock(g_states_mutex);
    auto existing = g_states.find(hwnd);
    if (existing != g_states.end()) {
      SynchronizeGeometry(hwnd, *existing->second, radius, material_width, material_height);
      SynchronizeActiveState(*existing->second, active);
      SynchronizeVisibility(hwnd, *existing->second, visible);
      return Result(env, true, true);
    }

    Trace("apply: dispatcher queue");
    EnsureDispatcherQueue();
    auto state = std::make_unique<GlassState>();
    Trace("apply: compositor");
    state->compositor = winrt::Windows::UI::Composition::Compositor();
    Trace("apply: desktop target");
    state->target = CreateTarget(state->compositor, hwnd);
    Trace("apply: root");
    state->root = state->compositor.CreateContainerVisual();
    state->root.RelativeSizeAdjustment({1.0f, 1.0f});

    Trace("apply: refractive backdrop layers");
    // Outermost to innermost. The final layer is the normal material center;
    // the preceding layers form a restrained 4-DIP optical rim.
    const struct {
      float inset;
      float additional_blur;
    } layer_specs[] = {
      {0.0f, 18.0f},
      {1.1f, 12.0f},
      {2.2f, 6.0f},
      {4.0f, 0.0f},
    };
    state->backdrop_layers.reserve(std::size(layer_specs));
    for (const auto& spec : layer_specs) {
      BackdropLayer layer;
      layer.logical_inset = spec.inset;
      layer.visual = state->compositor.CreateSpriteVisual();
      layer.effect = CreateBackdropEffect(
        state->compositor,
        static_cast<float>(blur_amount) + spec.additional_blur);
      layer.visual.Brush(layer.effect);
      layer.geometry = state->compositor.CreateRoundedRectangleGeometry();
      layer.clip = state->compositor.CreateGeometricClip(layer.geometry);
      layer.visual.Clip(layer.clip);
      state->root.Children().InsertAtTop(layer.visual);
      state->backdrop_layers.push_back(std::move(layer));
    }

    Trace("apply: tint visual");
    state->tint = state->compositor.CreateSpriteVisual();
    state->tint.RelativeSizeAdjustment({1.0f, 1.0f});
    const auto alpha = static_cast<std::uint8_t>(std::clamp(tint_opacity, 0.0, 1.0) * 255.0);
    state->tint.Brush(state->compositor.CreateColorBrush({alpha, 7, 8, 10}));

    Trace("apply: geometry");
    state->geometry = state->compositor.CreateRoundedRectangleGeometry();
    state->clip = state->compositor.CreateGeometricClip(state->geometry);
    state->root.Clip(state->clip);
    state->root.Children().InsertAtTop(state->tint);
    SynchronizeGeometry(hwnd, *state, radius, material_width, material_height);
    SynchronizeActiveState(*state, active);
    SynchronizeVisibility(hwnd, *state, visible);

    Trace("apply: dwm attributes");
    const BOOL disable_transitions = TRUE;
    DwmSetWindowAttribute(
      hwnd,
      DWMWA_TRANSITIONS_FORCEDISABLED,
      &disable_transitions,
      sizeof(disable_transitions));
    BOOL use_host_backdrop = TRUE;
    winrt::check_hresult(DwmSetWindowAttribute(
      hwnd,
      static_cast<DWMWINDOWATTRIBUTE>(kDwmUseHostBackdropBrush),
      &use_host_backdrop,
      sizeof(use_host_backdrop)));
    const COLORREF border_color = kDwmColorNone;
    DwmSetWindowAttribute(
      hwnd,
      static_cast<DWMWINDOWATTRIBUTE>(kDwmBorderColor),
      &border_color,
      sizeof(border_color));

    Trace("apply: target root");
    state->target.Root(state->root);
    Trace("apply: retain state");
    g_states.emplace(hwnd, std::move(state));
    Trace("apply: done");
    return Result(env, true, true);
  } catch (const winrt::hresult_error& error) {
    Trace("apply: hresult exception");
    return Result(env, true, false, winrt::to_string(error.message()));
  } catch (const std::exception& error) {
    Trace("apply: std exception");
    return Result(env, true, false, error.what());
  } catch (...) {
    Trace("apply: unknown exception");
    return Result(env, true, false, "unknown native composition error");
  }
}

Napi::Value Update(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const HWND hwnd = info.Length() > 0 ? WindowFromHandle(info[0]) : nullptr;
  if (!hwnd || info.Length() < 2 || !info[1].IsObject()) return Result(env, true, false, "invalid arguments");
  const auto options = info[1].As<Napi::Object>();
  const double radius = options.Has("radius") ? options.Get("radius").As<Napi::Number>().DoubleValue() : 18.0;
  const double material_width = options.Has("materialWidth")
    ? options.Get("materialWidth").As<Napi::Number>().DoubleValue()
    : 0.0;
  const double material_height = options.Has("materialHeight")
    ? options.Get("materialHeight").As<Napi::Number>().DoubleValue()
    : 0.0;
  const bool active = options.Has("active")
    ? options.Get("active").As<Napi::Boolean>().Value()
    : true;

  if (BridgeCall::Nested()) return Result(env, true, false, "nested call skipped");
  BridgeCall call;
  try {
    std::scoped_lock lock(g_states_mutex);
    const auto state = g_states.find(hwnd);
    if (state == g_states.end()) return Result(env, true, false, "glass is not attached");
    SynchronizeGeometry(hwnd, *state->second, radius, material_width, material_height);
    SynchronizeActiveState(*state->second, active);
    return Result(env, true, true);
  } catch (const winrt::hresult_error& error) {
    return Result(env, true, false, winrt::to_string(error.message()));
  } catch (const std::exception& error) {
    return Result(env, true, false, error.what());
  } catch (...) {
    return Result(env, true, false, "unknown native composition error");
  }
}

Napi::Value SetVisible(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const HWND hwnd = info.Length() > 0 ? WindowFromHandle(info[0]) : nullptr;
  if (!hwnd || info.Length() < 2 || !info[1].IsBoolean()) {
    return Result(env, true, false, "invalid arguments");
  }

  if (BridgeCall::Nested()) return Result(env, true, false, "nested call skipped");
  BridgeCall call;
  try {
    std::scoped_lock lock(g_states_mutex);
    const auto state = g_states.find(hwnd);
    if (state == g_states.end()) return Result(env, true, false, "glass is not attached");
    SynchronizeVisibility(hwnd, *state->second, info[1].As<Napi::Boolean>().Value());
    return Result(env, true, true);
  } catch (const winrt::hresult_error& error) {
    return Result(env, true, false, winrt::to_string(error.message()));
  } catch (const std::exception& error) {
    return Result(env, true, false, error.what());
  } catch (...) {
    return Result(env, true, false, "unknown native composition error");
  }
}

Napi::Value Detach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const HWND hwnd = info.Length() > 0 ? WindowFromHandle(info[0]) : nullptr;
  if (!hwnd) return Result(env, true, false, "invalid window handle");

  if (BridgeCall::Nested()) return Result(env, true, false, "nested call skipped");
  BridgeCall call;
  try {
    std::scoped_lock lock(g_states_mutex);
    const auto state = g_states.find(hwnd);
    if (state == g_states.end()) return Result(env, true, true);
    try {
      state->second->target.Root(nullptr);
    } catch (...) {
    }
    g_states.erase(state);
    return Result(env, true, true);
  } catch (...) {
    return Result(env, true, false, "detach failed");
  }
}

Napi::Object Initialize(Napi::Env env, Napi::Object exports) {
  if (GetEnvironmentVariableW(L"TAYLOS_GLASS_TRACE", nullptr, 0)) {
    AddVectoredExceptionHandler(1, FatalExceptionTrace);
    Trace("trace: vectored exception handler installed");
  }
  exports.Set("isSupported", Napi::Function::New(env, IsSupported));
  exports.Set("isKeyPressed", Napi::Function::New(env, IsKeyPressed));
  exports.Set("isMouseButtonPressed", Napi::Function::New(env, IsMouseButtonPressed));
  exports.Set("isCharacterChordPressed", Napi::Function::New(env, IsCharacterChordPressed));
  exports.Set("apply", Napi::Function::New(env, Apply));
  exports.Set("update", Napi::Function::New(env, Update));
  exports.Set("setVisible", Napi::Function::New(env, SetVisible));
  exports.Set("detach", Napi::Function::New(env, Detach));
  return exports;
}

}  // namespace

NODE_API_MODULE(taylos_windows_glass, Initialize)

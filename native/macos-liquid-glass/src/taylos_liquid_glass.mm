#include <napi.h>

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <objc/runtime.h>

#include <cstring>

@interface TaylosGlassState : NSObject
@property(nonatomic, strong) NSView *originalContentView;
@property(nonatomic, strong) NSView *glassView;
@end

@implementation TaylosGlassState
@end

namespace {

char kTaylosGlassStateKey;

Napi::Object Result(Napi::Env env, bool supported, bool applied, NSString *reason = nil) {
  Napi::Object result = Napi::Object::New(env);
  result.Set("supported", Napi::Boolean::New(env, supported));
  result.Set("applied", Napi::Boolean::New(env, applied));
  if (reason != nil) {
    result.Set("reason", Napi::String::New(env, reason.UTF8String));
  }
  return result;
}

bool RuntimeSupportsGlass() {
  if (@available(macOS 26.0, *)) {
    Class glassClass = NSClassFromString(@"NSGlassEffectView");
    return glassClass != Nil &&
      class_getInstanceMethod(glassClass, NSSelectorFromString(@"setContentView:")) != nullptr &&
      class_getInstanceMethod(glassClass, NSSelectorFromString(@"setCornerRadius:")) != nullptr;
  }
  return false;
}

NSView *ViewFromHandle(const Napi::Value &value) {
  if (!value.IsBuffer()) return nil;
  Napi::Buffer<uint8_t> buffer = value.As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() < sizeof(void *)) return nil;
  void *pointer = nullptr;
  std::memcpy(&pointer, buffer.Data(), sizeof(pointer));
  return (__bridge NSView *)pointer;
}

void SendObject(id receiver, NSString *selectorName, id value) {
  SEL selector = NSSelectorFromString(selectorName);
  if ([receiver respondsToSelector:selector]) {
    reinterpret_cast<void (*)(id, SEL, id)>(objc_msgSend)(receiver, selector, value);
  }
}

void SendBool(id receiver, NSString *selectorName, bool value) {
  SEL selector = NSSelectorFromString(selectorName);
  if ([receiver respondsToSelector:selector]) {
    reinterpret_cast<void (*)(id, SEL, BOOL)>(objc_msgSend)(receiver, selector, value ? YES : NO);
  }
}

void SendInteger(id receiver, NSString *selectorName, NSInteger value) {
  SEL selector = NSSelectorFromString(selectorName);
  if ([receiver respondsToSelector:selector]) {
    reinterpret_cast<void (*)(id, SEL, NSInteger)>(objc_msgSend)(receiver, selector, value);
  }
}

void SendCGFloat(id receiver, NSString *selectorName, CGFloat value) {
  SEL selector = NSSelectorFromString(selectorName);
  if ([receiver respondsToSelector:selector]) {
    reinterpret_cast<void (*)(id, SEL, CGFloat)>(objc_msgSend)(receiver, selector, value);
  }
}

void ConfigureGlass(NSView *glass, NSDictionary *configuration) {
  const CGFloat radius = [configuration[@"radius"] doubleValue];
  const BOOL active = [configuration[@"active"] boolValue];
  const BOOL interactive = [configuration[@"interactive"] boolValue];

  SendInteger(glass, @"setStyle:", 0); // NSGlassEffectViewStyleRegular
  SendCGFloat(glass, @"setCornerRadius:", radius);
  SendBool(glass, @"setEffectIsInteractive:", interactive);
  SendObject(glass, @"setTintColor:", nil);

  glass.wantsLayer = YES;
  glass.layer.cornerRadius = radius;
  glass.layer.masksToBounds = YES;
  glass.alphaValue = active ? 1.0 : 0.94;
}

void SynchronizeGlassGeometry(NSWindow *window, TaylosGlassState *state) {
  if (window == nil || state == nil) return;

  // NSGlassEffectView owns Chromium as its official content view, but Chromium
  // can resize its BrowserWindow after the native host is attached. Explicitly
  // synchronize both frames so the hosted renderer cannot retain stale bounds.
  const NSRect contentRect = [window contentRectForFrameRect:window.frame];
  const NSRect localBounds = NSMakeRect(0.0, 0.0, contentRect.size.width, contentRect.size.height);
  state.glassView.frame = localBounds;
  state.originalContentView.frame = state.glassView.bounds;
  [state.glassView setNeedsLayout:YES];
  [state.glassView layoutSubtreeIfNeeded];
}

Napi::Value IsSupported(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), RuntimeSupportsGlass());
}

Napi::Value Apply(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!RuntimeSupportsGlass()) return Result(env, false, false, @"NSGlassEffectView is unavailable");
  if (info.Length() < 2 || !info[1].IsObject()) return Result(env, true, false, @"invalid arguments");

  NSView *nativeView = ViewFromHandle(info[0]);
  if (nativeView == nil || nativeView.window == nil) return Result(env, true, false, @"native window handle is invalid");

  Napi::Object options = info[1].As<Napi::Object>();
  NSDictionary *configuration = @{
    @"radius": @((options.Has("radius") ? options.Get("radius").As<Napi::Number>().DoubleValue() : 18.0)),
    @"active": @((options.Has("active") ? options.Get("active").As<Napi::Boolean>().Value() : true)),
    @"interactive": @((options.Has("interactive") ? options.Get("interactive").As<Napi::Boolean>().Value() : false)),
  };

  __block NSString *failure = nil;
  void (^operation)(void) = ^{
    @try {
      NSWindow *window = nativeView.window;
      TaylosGlassState *state = objc_getAssociatedObject(window, &kTaylosGlassStateKey);
      if (state == nil) {
        NSView *original = window.contentView;
        if (original == nil) {
          failure = @"window has no content view";
          return;
        }

        Class glassClass = NSClassFromString(@"NSGlassEffectView");
        NSView *glass = [[glassClass alloc] initWithFrame:original.bounds];
        glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        original.frame = glass.bounds;
        original.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

        state = [TaylosGlassState new];
        state.originalContentView = original;
        state.glassView = glass;
        objc_setAssociatedObject(window, &kTaylosGlassStateKey, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

        window.opaque = NO;
        window.backgroundColor = NSColor.clearColor;
        window.hasShadow = YES;
        window.contentView = glass;
        SendObject(glass, @"setContentView:", original);
      }

      ConfigureGlass(state.glassView, configuration);
      SynchronizeGlassGeometry(window, state);
    } @catch (NSException *exception) {
      failure = exception.reason ?: @"native exception";
    }
  };

  if (NSThread.isMainThread) operation();
  else dispatch_sync(dispatch_get_main_queue(), operation);

  return failure == nil ? Result(env, true, true) : Result(env, true, false, failure);
}

Napi::Value Update(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!RuntimeSupportsGlass()) return Result(env, false, false, @"NSGlassEffectView is unavailable");
  if (info.Length() < 2 || !info[1].IsObject()) return Result(env, true, false, @"invalid arguments");

  NSView *nativeView = ViewFromHandle(info[0]);
  NSWindow *window = nativeView.window;
  TaylosGlassState *state = window == nil ? nil : objc_getAssociatedObject(window, &kTaylosGlassStateKey);
  if (state == nil) return Apply(info);

  Napi::Object options = info[1].As<Napi::Object>();
  NSDictionary *configuration = @{
    @"radius": @((options.Has("radius") ? options.Get("radius").As<Napi::Number>().DoubleValue() : 18.0)),
    @"active": @((options.Has("active") ? options.Get("active").As<Napi::Boolean>().Value() : true)),
    @"interactive": @((options.Has("interactive") ? options.Get("interactive").As<Napi::Boolean>().Value() : false)),
  };

  void (^operation)(void) = ^{
    ConfigureGlass(state.glassView, configuration);
    SynchronizeGlassGeometry(window, state);
  };
  if (NSThread.isMainThread) operation();
  else dispatch_sync(dispatch_get_main_queue(), operation);
  return Result(env, true, true);
}

Napi::Value Detach(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  NSView *nativeView = info.Length() > 0 ? ViewFromHandle(info[0]) : nil;
  NSWindow *window = nativeView.window;
  if (window == nil) return Result(env, RuntimeSupportsGlass(), false, @"window already released");

  void (^operation)(void) = ^{
    TaylosGlassState *state = objc_getAssociatedObject(window, &kTaylosGlassStateKey);
    if (state == nil) return;
    SendObject(state.glassView, @"setContentView:", nil);
    window.contentView = state.originalContentView;
    objc_setAssociatedObject(window, &kTaylosGlassStateKey, nil, OBJC_ASSOCIATION_ASSIGN);
  };
  if (NSThread.isMainThread) operation();
  else dispatch_sync(dispatch_get_main_queue(), operation);
  return Result(env, RuntimeSupportsGlass(), true);
}

} // namespace

Napi::Object Initialize(Napi::Env env, Napi::Object exports) {
  exports.Set("isSupported", Napi::Function::New(env, IsSupported));
  exports.Set("apply", Napi::Function::New(env, Apply));
  exports.Set("update", Napi::Function::New(env, Update));
  exports.Set("detach", Napi::Function::New(env, Detach));
  return exports;
}

NODE_API_MODULE(taylos_liquid_glass, Initialize)

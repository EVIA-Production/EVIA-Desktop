#include <napi.h>
#include <cstring>
#include <cmath>
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import "native-product-layout.h"

// Preview-only AppKit controls, hosted above Chromium without a Swift process.
@interface TaylosPassiveSymbolView : NSImageView
@end
@implementation TaylosPassiveSymbolView
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (BOOL)isFlipped { return NO; }
@end

static char symbolKey, scaleHostKey, activeAppearanceKey;
static NSMutableSet *appearanceClasses;

// Local review only: NSGlassEffectView has no public active-state override.
// Keep event routing intact; only answer its appearance queries as active.
// Never change Electron's NSWindow runtime class or override isKeyWindow.
static void KeepActiveAppearance(NSWindow *window) {
  objc_setAssociatedObject(window,&activeAppearanceKey,@YES,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  Class cls=object_getClass(window);
  if(!appearanceClasses)appearanceClasses=[NSMutableSet set];
  NSString *name=NSStringFromClass(cls);
  if([appearanceClasses containsObject:name])return;
  [appearanceClasses addObject:name];
  for(NSString *key in @[@"hasKeyAppearance",@"_hasKeyAppearance",@"_hasActiveAppearance",@"_hasActiveAppearanceIgnoringKeyFocus"]){
    SEL selector=NSSelectorFromString(key);
    Method method=class_getInstanceMethod(cls,selector);
    if(!method || method_getNumberOfArguments(method)!=2)continue;
    char type[32]={0};method_getReturnType(method,type,sizeof(type));
    if(strcmp(type,@encode(BOOL))!=0)continue;
    IMP previous=method_getImplementation(method);
    IMP replacement=imp_implementationWithBlock(^BOOL(id object){
      if([objc_getAssociatedObject(object,&activeAppearanceKey) boolValue])return YES;
      return ((BOOL(*)(id,SEL))previous)(object,selector);
    });
    if(!class_addMethod(cls,selector,replacement,method_getTypeEncoding(method)))
      method_setImplementation(class_getInstanceMethod(cls,selector),replacement);
  }
}
static __weak NSWindow *coachWindow;
static NSMutableArray *coachObservers;

static NSView *ViewFromHandle(const Napi::Value &value) {
  if (!value.IsBuffer()) return nil;
  auto buffer = value.As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() < sizeof(void *)) return nil;
  void *pointer = nullptr;
  std::memcpy(&pointer, buffer.Data(), sizeof(pointer));
  return (__bridge NSView *)pointer;
}

static void RaiseCoach() {
  NSWindow *coach = coachWindow;
  if (!coach) return;
  // Above all Taylos windows, but never a global overlay over other apps.
  coach.level = NSApp.isActive ? NSFloatingWindowLevel : NSNormalWindowLevel;
  if (NSApp.isActive && coach.isVisible) [coach orderFront:nil];
}

static void RemoveObservers() {
  for (id token in coachObservers) [[NSNotificationCenter defaultCenter] removeObserver:token];
  coachObservers = nil;
  coachWindow.level = NSNormalWindowLevel;
  coachWindow = nil;
}

static Napi::Value AttachCoach(const Napi::CallbackInfo &info) {
  RemoveObservers();
  coachWindow = ViewFromHandle(info[0]).window;
  coachObservers = [NSMutableArray array];
  for (NSNotificationName name in @[NSApplicationDidBecomeActiveNotification,
       NSApplicationDidResignActiveNotification, NSWindowDidBecomeKeyNotification]) {
    id token = [[NSNotificationCenter defaultCenter] addObserverForName:name object:nil
      queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification *notification) { RaiseCoach(); }];
    [coachObservers addObject:token];
  }
  RaiseCoach();
  return Napi::Boolean::New(info.Env(), coachWindow != nil);
}

static Napi::Value UpdateSymbol(const Napi::CallbackInfo &info) {
  NSView *host = ViewFromHandle(info[0]).window.contentView;
  if (!host || !info[1].IsObject()) return Napi::Boolean::New(info.Env(), false);
  auto config = info[1].As<Napi::Object>();
  TaylosPassiveSymbolView *view = objc_getAssociatedObject(host, &symbolKey);
  if (!config.Get("visible").ToBoolean().Value()) {
    [view removeFromSuperview];
    objc_setAssociatedObject(host, &symbolKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    return Napi::Boolean::New(info.Env(), true);
  }
  const auto number = [&](const char *key) { return config.Get(key).ToNumber().DoubleValue(); };
  CGFloat x = number("x"), y = number("y"), width = number("width"), height = number("height");
  if (!std::isfinite(x) || !std::isfinite(y) || width <= 0 || height <= 0 || width > 64 || height > 64)
    return Napi::Boolean::New(info.Env(), false);
  if (!view) {
    view = [[TaylosPassiveSymbolView alloc] initWithFrame:NSZeroRect];
    view.image = [[NSImage imageWithSystemSymbolName:@"checkmark" accessibilityDescription:nil]
      imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:18 weight:NSFontWeightMedium]];
    view.contentTintColor = NSColor.systemGreenColor;
    view.imageScaling = NSImageScaleProportionallyUpOrDown;
    [host addSubview:view positioned:NSWindowAbove relativeTo:nil];
    objc_setAssociatedObject(host, &symbolKey, view, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  view.frame = NSMakeRect(x, host.isFlipped ? y : NSHeight(host.bounds)-y-height, width, height);
  [CATransaction commit];
  if (config.Get("animate").ToBoolean().Value() && !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
    Class drawOn = NSClassFromString(@"NSSymbolDrawOnEffect");
    if (drawOn && [drawOn respondsToSelector:@selector(effect)]) {
      [view removeAllSymbolEffects];
      // Commit the native image's first frame before starting the effect.
      // Starting it while attaching the view can skip the draw-on entirely.
      [view layoutSubtreeIfNeeded];
      [view displayIfNeeded];
      dispatch_async(dispatch_get_main_queue(), ^{
        if (!view.superview) return;
        id effect = ((id (*)(id, SEL))objc_msgSend)(drawOn, @selector(effect));
        [view addSymbolEffect:effect];
      });
    }
  }
  return Napi::Boolean::New(info.Env(), true);
}

static void ActivateEffects(NSView *view) {
  if ([view isKindOfClass:NSVisualEffectView.class])
    ((NSVisualEffectView *)view).state = NSVisualEffectStateActive;
  for (NSView *child in view.subviews) ActivateEffects(child);
}

static Napi::Value RefreshProductAppearance(const Napi::CallbackInfo &info) {
  NSWindow *window = ViewFromHandle(info[0]).window;
  if (!window) return Napi::Boolean::New(info.Env(), false);
  KeepActiveAppearance(window);
  // Public AppKit APIs. Keep the material active without making every window key.
  ActivateEffects(window.contentView);
  window.hasShadow = objc_getAssociatedObject(window,&scaleHostKey) == nil;
  if(window.hasShadow)[window invalidateShadow];
  return Napi::Boolean::New(info.Env(), true);
}

static Napi::Value LayoutProduct(const Napi::CallbackInfo &info) {
  NSWindow *window = ViewFromHandle(info[0]).window;
  if (!window || !info[1].IsObject()) return Napi::Boolean::New(info.Env(), false);
  auto c = info[1].As<Napi::Object>();
  CGFloat w=c.Get("width").ToNumber().DoubleValue(), h=c.Get("height").ToNumber().DoubleValue();
  if (w<=0 || h<=0 || !std::isfinite(w+h)) return Napi::Boolean::New(info.Env(), false);
  CGFloat scale=c.Get("scale").ToNumber().DoubleValue();
  TaylosScaleHost *host=objc_getAssociatedObject(window,&scaleHostKey);
  if(!host){
    NSView *product=window.contentView;
    host=[[TaylosScaleHost alloc] initWithFrame:product.frame];
    host.wantsLayer=YES;host.product=product;
    host.canvas=[[NSView alloc] initWithFrame:product.frame];
    host.canvas.wantsLayer=YES;
    window.contentView=host;
    [host addSubview:host.canvas];[host.canvas addSubview:product];
    objc_setAssociatedObject(window,&scaleHostKey,host,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  NSView *glass=host.product;
  [CATransaction begin]; [CATransaction setDisableActions:YES];
  NSRect frame=[window contentRectForFrameRect:window.frame];
  host.frame=NSMakeRect(0,0,frame.size.width,frame.size.height);
  LayoutProductCanvas(host,NSMakeSize(w,h),scale);
  // The shadow belongs to the same composited layer as the product. Window
  // Server alpha-mask shadows are asynchronous and lag behind a scaled layer.
  const CGFloat radius=c.Get("radius").ToNumber().DoubleValue();
  glass.layer.masksToBounds=NO;
  glass.layer.shadowColor=NSColor.blackColor.CGColor;
  glass.layer.shadowOpacity=.46;
  glass.layer.shadowRadius=14;
  glass.layer.shadowOffset=CGSizeMake(0,-7);
  CGPathRef outline=CGPathCreateWithRoundedRect(CGRectMake(0,0,w,h),radius,radius,nullptr);
  glass.layer.shadowPath=outline;CGPathRelease(outline);
  ActivateEffects(glass); window.hasShadow=NO;
  [CATransaction commit];
  return Napi::Boolean::New(info.Env(), true);
}

static Napi::Value RestoreProduct(const Napi::CallbackInfo &info) {
  NSWindow *window=ViewFromHandle(info[0]).window;
  TaylosScaleHost *host=objc_getAssociatedObject(window,&scaleHostKey);
  if(!window||!host)return Napi::Boolean::New(info.Env(),false);
  auto config=info[1].As<Napi::Object>();
  RestoreProductRoot(window,host,NSMakeSize(config.Get("width").ToNumber().DoubleValue(),config.Get("height").ToNumber().DoubleValue()));
  objc_setAssociatedObject(window,&scaleHostKey,nil,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  KeepActiveAppearance(window);
  return Napi::Boolean::New(info.Env(),true);
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("inputGeometry",Napi::Function::New(env,[](const Napi::CallbackInfo &info){
    NSWindow *window=ViewFromHandle(info[0]).window;
    NSPoint point=window.mouseLocationOutsideOfEventStream;
    NSView *hit=[window.contentView hitTest:point];
    NSMutableArray *lines=[NSMutableArray array];
    for(NSView *view=hit;view;view=view.superview)
      [lines addObject:[NSString stringWithFormat:@"%@ frame=%@ bounds=%@ flipped=%d",NSStringFromClass(view.class),NSStringFromRect(view.frame),NSStringFromRect(view.bounds),view.isFlipped]];
    NSString *description=[NSString stringWithFormat:@"mouse=%@ hit=%@",NSStringFromPoint(point),[lines componentsJoinedByString:@" | "]];
    return Napi::String::New(info.Env(),description.UTF8String);
  }));
  exports.Set("drawOnAvailable", Napi::Boolean::New(env, NSClassFromString(@"NSSymbolDrawOnEffect") != nil));
  exports.Set("updateSymbol", Napi::Function::New(env, UpdateSymbol));
  exports.Set("attachCoach", Napi::Function::New(env, AttachCoach));
  exports.Set("refreshProductAppearance", Napi::Function::New(env, RefreshProductAppearance));
  exports.Set("restoreProduct", Napi::Function::New(env, RestoreProduct));
  exports.Set("layoutProduct", Napi::Function::New(env, LayoutProduct));
  exports.Set("raiseCoach", Napi::Function::New(env, [](const Napi::CallbackInfo &info) { RaiseCoach(); return info.Env().Undefined(); }));
  exports.Set("dispose", Napi::Function::New(env, [](const Napi::CallbackInfo &info) { RemoveObservers(); return info.Env().Undefined(); }));
  return exports;
}
NODE_API_MODULE(taylos_onboarding_controls, Init)

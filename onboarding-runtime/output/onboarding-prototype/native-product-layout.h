#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

@interface TaylosContentFrameObserver : NSObject
@property(nonatomic,weak) NSView *view;
@end
@implementation TaylosContentFrameObserver
- (void)align:(NSNotification *)notification {
  NSView *view=self.view;
  if(!view.superview)return;
  NSRect target=NSMakeRect(0,0,NSWidth(view.superview.bounds),NSHeight(view.superview.bounds));
  if(!NSEqualRects(view.frame,target))view.frame=target;
}
- (void)dealloc { [[NSNotificationCenter defaultCenter] removeObserver:self]; }
@end
static char contentFrameObserverKey;

@interface TaylosScaleHost : NSView
@property(nonatomic,strong) NSView *product;
@property(nonatomic,strong) NSView *canvas;
@end
@implementation TaylosScaleHost
@end

static inline void SetFrameIfChanged(NSView *view, NSRect frame) {
  if (!NSEqualRects(view.frame, frame)) view.frame = frame;
  NSRect bounds = NSMakeRect(0, 0, frame.size.width, frame.size.height);
  if (!NSEqualRects(view.bounds, bounds)) view.bounds = bounds;
}

static void AlignChromiumContent(NSView *view, NSSize size) {
  // Electron's Views layer can preserve window-relative WebContents coordinates
  // when its original content view is moved into the glass canvas.
  if([NSStringFromClass(view.class) isEqualToString:@"WebContentsViewCocoa"]) {
    if(!objc_getAssociatedObject(view,&contentFrameObserverKey)) {
      TaylosContentFrameObserver *observer=[TaylosContentFrameObserver new];observer.view=view;
      view.postsFrameChangedNotifications=YES;
      [[NSNotificationCenter defaultCenter] addObserver:observer selector:@selector(align:)
        name:NSViewFrameDidChangeNotification object:view];
      objc_setAssociatedObject(view,&contentFrameObserverKey,observer,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    SetFrameIfChanged(view, NSMakeRect(0,0,size.width,size.height));
    return;
  }
  for(NSView *child in view.subviews)AlignChromiumContent(child,size);
}

static void LayoutProductCanvas(TaylosScaleHost *host, NSSize size, CGFloat scale) {
  NSView *canvas=host.canvas, *product=host.product;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  // AppKit must own the transformation so drawing, hit testing, hover and
  // Chromium's window-to-view conversion all use the same coordinate space.
  // The product's logical dimensions stay fixed throughout the reveal.
  // Only the canvas frame moves per tick. Everything inside keeps its logical
  // geometry, so Chromium never sees a frame change and never re-rasterizes.
  canvas.frame=NSMakeRect((NSWidth(host.bounds)-size.width*scale)/2,
    (NSHeight(host.bounds)-size.height*scale)/2,size.width*scale,size.height*scale);
  NSRect logical=NSMakeRect(0,0,size.width,size.height);
  if(!NSEqualRects(canvas.bounds,logical))canvas.bounds=logical;
  product.autoresizingMask=NSViewNotSizable;
  SetFrameIfChanged(product,logical);
  if([product respondsToSelector:@selector(contentView)]) {
    NSView *content=[(id)product contentView];
    SetFrameIfChanged(content,logical);
  }
  AlignChromiumContent(product,size);
  [CATransaction commit];
}

static void RemoveContentFrameObservers(NSView *view) {
  objc_setAssociatedObject(view,&contentFrameObserverKey,nil,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  for(NSView *child in view.subviews)RemoveContentFrameObservers(child);
}

static void RestoreProductRoot(NSWindow *window, TaylosScaleHost *host, NSSize size) {
  NSView *product=host.product;
  [CATransaction begin];[CATransaction setDisableActions:YES];
  RemoveContentFrameObservers(product);
  [product removeFromSuperview];
  window.contentView=product;
  product.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
  product.frame=NSMakeRect(0,0,size.width,size.height);product.bounds=product.frame;
  product.layer.shadowOpacity=0;product.layer.shadowPath=nil;
  product.layer.masksToBounds=YES;
  if([product respondsToSelector:@selector(contentView)]) {
    NSView *content=[(id)product contentView];
    content.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
    content.frame=product.bounds;content.bounds=product.bounds;
  }
  host.product=nil;host.canvas=nil;
  window.hasShadow=YES;[window invalidateShadow];
  [CATransaction commit];
}

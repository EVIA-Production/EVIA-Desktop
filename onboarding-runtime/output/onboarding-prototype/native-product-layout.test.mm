#import "native-product-layout.h"
#include <cassert>
#include <cmath>
#include <cstdio>

@interface FlippedProduct : NSView
@end
@implementation FlippedProduct
- (BOOL)isFlipped { return YES; }
@end

@interface WebContentsViewCocoa : NSView
@end
@implementation WebContentsViewCocoa
@end

int main() {
  @autoreleasepool {
    for(NSValue *value in @[[NSValue valueWithSize:NSMakeSize(338,49)],
        [NSValue valueWithSize:NSMakeSize(640,254)],
        [NSValue valueWithSize:NSMakeSize(400,320)]]) {
      NSSize size=value.sizeValue;
      TaylosScaleHost *host=[[TaylosScaleHost alloc] initWithFrame:NSMakeRect(0,0,size.width+80,size.height+80)];
      host.canvas=[[NSView alloc] initWithFrame:NSZeroRect];
      host.product=[[FlippedProduct alloc] initWithFrame:NSMakeRect(0,0,size.width,size.height)];
      [host addSubview:host.canvas];[host.canvas addSubview:host.product];
      NSView *button=[[NSView alloc] initWithFrame:NSMakeRect(size.width-55,10,40,24)];
      [host.product addSubview:button];
      for(NSNumber *number in @[@.5,@.73,@1,@.62,@1]) {
        CGFloat scale=number.doubleValue;
        LayoutProductCanvas(host,size,scale);
        NSPoint local=NSMakePoint(size.width-35,22);
        NSPoint visible=NSMakePoint((NSWidth(host.bounds)-size.width*scale)/2+local.x*scale,
          (NSHeight(host.bounds)-size.height*scale)/2+(size.height-local.y)*scale);
        NSPoint actual=[host.product convertPoint:visible fromView:host];
        assert(std::abs(actual.x-local.x)<.001 && std::abs(actual.y-local.y)<.001);
        assert([host hitTest:visible]==button);
        assert(NSEqualSizes(host.product.bounds.size,size));
        assert(NSEqualSizes(host.product.frame.size,size));
      }
    }
    NSView *bridge=[[NSView alloc] initWithFrame:NSMakeRect(0,0,400,320)];
    WebContentsViewCocoa *web=[[WebContentsViewCocoa alloc] initWithFrame:NSMakeRect(-40,40,400,320)];
    [bridge addSubview:web];
    AlignChromiumContent(bridge,bridge.bounds.size);
    assert(NSEqualRects(web.frame,bridge.bounds));
    // Simulate the delayed frame correction Electron sends after reparenting.
    web.frame=NSMakeRect(-40,40,400,320);
    assert(NSEqualRects(web.frame,bridge.bounds));
    bridge.frame=NSMakeRect(0,0,640,254);
    web.frame=NSMakeRect(-40,40,640,254);
    assert(NSEqualRects(web.frame,bridge.bounds));
    RemoveContentFrameObservers(bridge);
    web.frame=NSMakeRect(0,3,640,254);
    assert(web.frame.origin.y==3); // Normal production geometry is no longer overridden.
  }
  puts("Native product hit testing: five reveal scales and delayed Chromium frame changes pass.");
}

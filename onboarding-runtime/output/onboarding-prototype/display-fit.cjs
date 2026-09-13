// The backdrop fills the selected display in DIP coordinates, including after
// resolution/scale changes or removing that display. No fixed pixel dimensions.
module.exports = function fitDisplay(window, screen, initialDisplay) {
  let displayId=initialDisplay.id;
  const update=()=>{
    if(window.isDestroyed())return;
    const display=screen.getAllDisplays().find(item=>item.id===displayId)
      || screen.getDisplayMatching(window.getBounds());
    displayId=display.id;
    const bounds=display.bounds, current=window.getBounds();
    if(['x','y','width','height'].some(key=>bounds[key]!==current[key]))window.setBounds(bounds,false);
  };
  const metrics=(_event,display)=>{if(display.id===displayId)update();};
  screen.on('display-metrics-changed',metrics);
  screen.on('display-removed',update);
  update();
  return ()=>{screen.removeListener('display-metrics-changed',metrics);screen.removeListener('display-removed',update);};
};

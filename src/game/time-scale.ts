import { approach, clamp } from '../math/vec';

export const TimeScaleDriver = class _TimeScaleDriver {
  static MIN = 0.015;
  static LOOK_WEIGHT = 0.35;
  static LOOK_FULL = 900;
  static KICK_TIME = 0.12;
  static RISE = 0.05;
  static FALL = 0.1;
  value = _TimeScaleDriver.MIN;
  kick = 0;
  reset() {
    this.value = _TimeScaleDriver.MIN;
    this.kick = 0;
  }
  actionKick() {
    this.kick = _TimeScaleDriver.KICK_TIME;
  }
  update(realDt: number, planarSpeed: number, maxSpeed: number, lookSpeed: number, airborne: boolean, busy: boolean) {
    this.kick = Math.max(0, this.kick - realDt);
    const moveInput = clamp(planarSpeed / maxSpeed, 0, 1);
    const lookInput = clamp(lookSpeed / _TimeScaleDriver.LOOK_FULL, 0, 1) * _TimeScaleDriver.LOOK_WEIGHT;
    const kickInput = this.kick > 0 || busy ? 1 : 0;
    let target = Math.max(moveInput, lookInput, kickInput);
    if (airborne)
      target = Math.max(target, 0.8);
    target = Math.max(target, _TimeScaleDriver.MIN);
    const tau = target > this.value ? _TimeScaleDriver.RISE : _TimeScaleDriver.FALL;
    this.value = clamp(approach(this.value, target, tau, realDt), _TimeScaleDriver.MIN, 1);
    return this.value;
  }
};

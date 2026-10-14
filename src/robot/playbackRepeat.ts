export interface RepeatOptions {
  drill: boolean;
  song: boolean;
  songLength: number;
}

export function resolveRepeatPlayback(elapsed: number, drillLength: number, options: RepeatOptions) {
  const hasSong = options.songLength > 0;
  const end = options.drill
    ? hasSong && !options.song ? options.songLength : Infinity
    : drillLength;
  const time = Math.max(0, Math.min(elapsed, end));
  const loopBeat = drillLength > 0 ? time % drillLength : 0;
  const drillBeat = options.drill && drillLength > 0
    ? time === end && time > 0 && loopBeat === 0 ? drillLength : loopBeat
    : Math.min(drillLength, time);
  return {
    elapsed: time,
    drillBeat,
    songBeat: hasSong && options.song ? time % options.songLength : time,
    songCycle: hasSong && options.song ? Math.floor(time / options.songLength) : 0,
    songEnd: hasSong ? options.songLength : drillLength,
    ended: elapsed >= end,
  };
}

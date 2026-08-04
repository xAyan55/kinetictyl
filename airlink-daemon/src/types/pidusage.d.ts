declare module 'pidusage' {
  interface Stat {
    cpu: number;
    memory: number;
    ppid: number;
    pid: number;
    ctime: number;
    elapsed: number;
    timestamp: number;
  }
  function pidusage(pid: number | string, callback?: (err: Error | null, stat: Stat) => void): Promise<Stat>;
  export = pidusage;
}

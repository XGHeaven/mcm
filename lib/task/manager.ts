import { colors, async } from "../deps.ts";

interface TaskContext {
  startLongPhase: () => void;
  stopLongPhase: () => void;
  queue: (name: string, exe: TaskExecutor) => Promise<void>;
  queueGroup: (
    name: string,
    exeMap: GroupTaskExecutor,
    bailout?: boolean,
  ) => Promise<void>;
  task: Task;
}

export type TaskExecutor = (context: TaskContext) => Promise<void> | void;

export type GroupTaskExecutor = Record<string, TaskExecutor>;

enum TaskStatus {
  WAITING,
  RUNNING,
  ERROR,
  DONE,
}

interface Task {
  name: string;
  status: TaskStatus;
  executor: TaskExecutor;
  defer: async.Deferred<void>;
  startTime: number;
  inLongPhase: boolean;
  longTaskTimer: number;
  group: Group | null;
}

interface Group {
  total: number;
  finished: number;
  error: number;
  name: string;
  bailout: boolean;
  defer: async.Deferred<void>;
}

function createTask(
  name: string,
  exe: TaskExecutor,
  group: Group | null = null,
): Task {
  const defer = async.deferred<void>();
  defer.catch(() => {
    // 至少补充一个 error catch，避免程序不必要崩溃
  });
  return {
    name,
    executor: exe,
    status: TaskStatus.WAITING,
    defer,
    startTime: 0,
    inLongPhase: false,
    longTaskTimer: 0,
    group,
  };
}

function createGroup(name: string): Group {
  const defer = async.deferred<void>();

  defer.catch(() => {
    // 至少补充一个 error catch，避免程序不必要崩溃
  });

  return {
    name,
    total: 0,
    finished: 0,
    error: 0,
    bailout: false,
    defer,
  };
}

export class GroupTaskCollector {
  group: GroupTaskExecutor = {};

  constructor(initial?: Array<[string, TaskExecutor]>) {
    if (Array.isArray(initial)) {
      for (const [name, exe] of initial) {
        this.collect(name, exe);
      }
    }
  }

  collect(name: string, exe: TaskExecutor) {
    this.group[name] = exe;
  }
}

interface TaskManagerOptions {
  parallel?: number;
  longTaskTimeout?: number;
  maxParallel?: number;
}

export class TaskManager {
  #minParallel = 8;
  #maxParallel = 8;
  #parallel = 8;
  #running = 0;
  #tasks: Task[] = [];
  #longTaskTimeout = 0;
  #defer = async.deferred<void>();

  constructor(options: TaskManagerOptions = {}) {
    this.#parallel = this.#minParallel = options.parallel ?? 8;
    this.#maxParallel = options.maxParallel ?? this.#parallel * 4;
    this.#longTaskTimeout = options.longTaskTimeout ?? 30 * 1000;
  }

  queue(name: string, executor: TaskExecutor): Promise<void> {
    const task = createTask(name, executor);
    this._addTask(task);

    this.run();

    return task.defer;
  }

  queueGroup(
    name: string,
    exeMap: GroupTaskExecutor,
    bailout = false,
  ): Promise<void> {
    const group = createGroup(name);
    const exeEntries = Object.entries(exeMap);
    group.bailout = bailout;
    group.total = exeEntries.length;
    for (const [exeName, exe] of exeEntries) {
      this._addTask(createTask(exeName, exe, group));
    }
    this.run();
    return group.defer;
  }

  waitAllFinished(): Promise<void> {
    return this.#defer;
  }

  run() {
    for (const task of this.#tasks) {
      if (this.#running >= this.#parallel) {
        break;
      }
      if (task.status === TaskStatus.WAITING) {
        this._runTask(task);
      }
    }
  }

  private _startLongPhase(task: Task) {
    if (task.inLongPhase) {
      console.error(`Task ${task.name} always in long phase`);
      return;
    }

    task.inLongPhase = true;
    this.changeParallel(1);
    clearTimeout(task.longTaskTimer);
  }

  private _stopLongPhase(task: Task) {
    if (task.inLongPhase) {
      task.inLongPhase = false;
      this.changeParallel(-1);
    }
  }

  private _reportLongTask(task: Task) {
    console.warn(`${colors.yellow("timeout")} ${task.name} running over 30s`);
    // TODO shrink parallel
  }

  private _runTask(task: Task) {
    this.#running++;
    task.status = TaskStatus.RUNNING;
    task.startTime = performance.now();
    console.log(`${colors.magenta("run")} ${task.name}`);
    const runner = Promise.resolve().then(() =>
      task.executor({
        startLongPhase: this._startLongPhase.bind(this, task),
        stopLongPhase: this._stopLongPhase.bind(this, task),
        queue: this.queue.bind(this),
        queueGroup: this.queueGroup.bind(this),
        task,
      })
    );
    const name = colors.blue(task.name);
    task.longTaskTimer = setTimeout(
      this._reportLongTask.bind(this, task),
      this.#longTaskTimeout,
    );

    const finish = () => {
      this._stopLongPhase(task);
      clearTimeout(task.longTaskTimer);
      this.#running--;
      this._removeTask(task);

      if (task.group) {
        this._finishOneOfGroup(task.group);
      }

      Promise.resolve().then(() => this.run());
    };

    const toNowString = () =>
      colors.gray(`${(performance.now() - task.startTime).toFixed(2)}ms`);

    runner.then(() => {
      task.status = TaskStatus.DONE;
      task.defer.resolve();
      finish();
      console.log(
        `${colors.green("finished")} ${name} ${toNowString()}${
          this._formatGroupPercent(task.group)
        }`,
      );
    }, (e) => {
      task.status = TaskStatus.ERROR;
      task.defer.reject(e);
      if (task.group) {
        task.group.error++;
      }
      finish();
      console.log(
        `${colors.red("error")} ${name} ${toNowString()}${
          this._formatGroupPercent(task.group)
        }`,
      );
    });
  }

  private _finishOneOfGroup(group: Group) {
    if (group.bailout && group.error) {
      group.defer.reject(new Error(`Group ${group.name} bailout`));
      // 并且把相关的 task 全部清除，不管是正在运行的还是没在运行的
      for (const task of this.#tasks.slice(0)) {
        if (task.group === group) {
          this._removeTask(task);
        }
      }
      return;
    }

    group.finished++;

    if (group.finished === group.total) {
      if (group.error) {
        group.defer.reject(
          new Error(`Group ${group.name} has ${group.error} error(s)`),
        );
      } else {
        group.defer.resolve();
      }
    }
  }

  private _formatGroupPercent(group: Group | null) {
    if (!group) {
      return "";
    }

    if (group.bailout) {
      return colors.gray(`(${group.finished}/${group.total})`);
    }
    return colors.gray(
      `(${group.finished}/${
        group.error ? colors.red(String(group.error)) : group.error
      }/${group.total})`,
    );
  }

  private changeParallel(delta: number) {
    this.#parallel = Math.min(
      Math.max(this.#parallel + delta, this.#minParallel),
      this.#maxParallel,
    );
    Promise.resolve().then(() => this.run());
  }

  private _addTask(task: Task) {
    if (!this.#tasks.length) {
      this.#defer = async.deferred();
    }
    this.#tasks.push(task);
  }

  private _removeTask(task: Task) {
    const index = this.#tasks.indexOf(task);
    if (index !== -1) {
      this.#tasks.splice(index, 1);
    }
    if (this.#tasks.length === 0) {
      this.#defer.resolve();
    }
  }
}

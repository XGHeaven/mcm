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
  waitTask: (taskPromise: Promise<any>) => Promise<void>;
  runTask: (exe: TaskExecutor) => Promise<void>;
  task: TaskNode;
  tasks: TaskManager;
}

export type TaskExecutor = (context: TaskContext) => Promise<void> | void;

export type GroupTaskExecutor = Record<string, TaskExecutor>;

enum TaskStatus {
  WAITING,
  RUNNING,
  ERROR,
  DONE,
}

function readableDisplayNames(names: string[]): string {
  return names.map((name) => colors.blue(name)).join(colors.gray("->"));
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

abstract class TreeNode {
  status: TaskStatus = TaskStatus.WAITING;
  child: TreeNode | null = null;
  sibling: TreeNode | null = null;
  defer = async.deferred<void>();
  displayNames: string[];

  totalChildren = 0;
  childFinished = 0;
  childError = 0;

  protected errors: any[] = [];

  constructor(public name: string, public parent: TreeNode) {
    // 补充一个默认 catch handler，避免程序异常退出
    this.defer.catch(() => {});

    const names: string[] = [];
    let node: TreeNode = this;
    // 因为针对 RootNode，这里传的是 null，所以要单独判断下
    while (node && node.parent !== node) {
      names.push(node.name);
      node = node.parent;
    }

    this.displayNames = names.reverse();
  }

  onChildFinished(err?: any) {
    this.childFinished += 1;
    if (err) {
      this.childError += 1;
      this.errors.push(err);
    }
  }

  addChild(child: TreeNode) {
    if (!this.child) {
      this.child = child;
    } else {
      let last = this.child;
      while (last.sibling) {
        last = last.sibling;
      }
      last.sibling = child;
    }

    this.totalChildren += 1;
  }

  removeTask(child: TreeNode) {
    let pre: TreeNode | null = null;
    let node = this.child;

    while (node && node !== child) {
      pre = node;
      if (node.sibling) {
        node = node.sibling;
      }
    }

    if (node) {
      if (pre) {
        pre.sibling = node.sibling;
      } else {
        this.child = node.sibling;
      }
    } else {
      console.log("cannot found");
    }
  }
}

class TaskNode extends TreeNode {
  startTime = 0;
  longTaskTimer = 0;
  inLongPhase = false;
  longTaskCount = 0;

  #timeoutTimer = 0;
  #timeoutCount = 0;
  #timeout = 0;

  constructor(
    name: string,
    public executor: TaskExecutor,
    public parent: TreeNode,
  ) {
    super(name, parent);
  }

  enableTimeoutReport(timeout: number) {
    this.#timeout = timeout;
    this.#timeoutCount = 0;
    if (!this.#timeoutTimer) {
      this.#timeoutTimer = setTimeout(() => this.reportTimeout(), timeout);
    }
  }

  disableTimeoutReport() {
    clearTimeout(this.#timeoutTimer);
    this.#timeoutTimer = 0;
  }

  private reportTimeout() {
    this.#timeoutCount += 1;
    console.warn(
      `${colors.yellow("timeout")} ${
        readableDisplayNames(this.displayNames)
      } running over ${Math.floor(this.#timeout * this.#timeoutCount / 1000)}s`,
    );
    this.#timeoutTimer = setTimeout(() => this.reportTimeout(), this.#timeout);
  }
}

class GroupNode extends TreeNode {
  #bailouted = false;

  constructor(
    name: string,
    public parent: TreeNode,
    public bailout: boolean = false,
  ) {
    super(name, parent);
  }

  onChildFinished(err?: any) {
    super.onChildFinished(err);
    if (this.bailout) {
      if (!this.child) {
        // 所有任务都结束了
        if (this.childError) {
          this.defer.reject(this.errors[0]);
        } else {
          this.defer.resolve();
        }
      } else if (err && !this.#bailouted) {
        this.#bailouted = true;
        this._cleanWaitingChild();
        if (!this.child) {
          this.defer.reject(err);
        }
      }
    } else {
      if (this.childFinished === this.totalChildren) {
        if (this.childError) {
          this.defer.reject(new Error(this.errors[0]));
        } else {
          this.defer.resolve();
        }
      }
    }
  }

  private _cleanWaitingChild() {
    let node = this.child;
    while (node) {
      if (node.status === TaskStatus.WAITING) {
        node = node.sibling;
      } else {
        break;
      }
    }

    this.child = node;
    while (node) {
      if (node.sibling) {
        if (node.sibling.status === TaskStatus.WAITING) {
          node.sibling = node.sibling.sibling;
        } else {
          node = node.sibling;
        }
      } else {
        break;
      }
    }
  }
}

class RootNode extends TreeNode {
  constructor() {
    super("root", null as any);
    this.parent = this;
  }
}

interface TaskManagerOptions {
  parallel?: number;
  longTaskTimeout?: number;
}

export class TaskManager {
  #minParallel = 8;
  #parallel = 8;
  #running = 0;
  #longTaskTimeout = 0;
  #root: TreeNode = new RootNode();

  constructor(options: TaskManagerOptions = {}) {
    this.#parallel = this.#minParallel = options.parallel ?? 8;
    this.#longTaskTimeout = options.longTaskTimeout ?? 30 * 1000;
  }

  queue = this._queue.bind(this, null);

  queueGroup = this._queueGroup.bind(this, null);

  waitAllFinished(): Promise<void> {
    return this.#root.defer;
  }

  run() {
    let node = this.#root.child;
    let nextNode: TreeNode | null = node;
    if (!node) {
      if (this.#root.childError) {
        this.#root.defer.reject(new Error("root error"));
      } else {
        this.#root.defer.resolve();
      }
      return;
    }
    while (nextNode && this.#running < this.#parallel) {
      node = nextNode;

      if (node instanceof TaskNode && node.status === TaskStatus.WAITING) {
        this._runTask(node);
      }

      if (node.child) {
        nextNode = node.child;
      } else if (node.sibling) {
        nextNode = node.sibling;
      } else {
        do {
          nextNode = nextNode.parent;
        } while (nextNode && !nextNode.sibling && nextNode !== this.#root);
        if (nextNode) {
          nextNode = nextNode.sibling;
        }
      }
    }
  }

  private _startLongPhase(task: TaskNode) {
    if (task.inLongPhase) {
      console.error(`Task ${task.name} always in long phase`);
      return;
    }

    task.inLongPhase = true;
    this.changeParallel(1);
    task.disableTimeoutReport();
  }

  private _stopLongPhase(task: TaskNode) {
    if (task.inLongPhase) {
      task.inLongPhase = false;
      this.changeParallel(-1);
      task.enableTimeoutReport(this.#longTaskTimeout);
    }
  }

  private async _waitTask(
    task: TaskNode,
    promise: Promise<void>,
  ): Promise<void> {
    this._startLongPhase(task);
    await promise;
    this._stopLongPhase(task);
  }

  private _generateTaskContext(task: TaskNode): TaskContext {
    return {
      startLongPhase: this._startLongPhase.bind(this, task),
      stopLongPhase: this._stopLongPhase.bind(this, task),
      queue: this._queue.bind(this, task),
      queueGroup: this._queueGroup.bind(this, task),
      waitTask: this._waitTask.bind(this, task),
      task,
      tasks: this,
      runTask: (exe) => Promise.resolve(exe(this._generateTaskContext(task))),
    };
  }

  private _runTask(task: TaskNode) {
    this.#running++;
    task.status = TaskStatus.RUNNING;
    task.startTime = performance.now();
    const name = this.getDisplayName(task);
    console.log(`${colors.magenta("run")} ${name}`);
    const runner = Promise.resolve().then(() =>
      task.executor(this._generateTaskContext(task))
    );
    task.enableTimeoutReport(this.#longTaskTimeout);

    const finish = (e?: any) => {
      const timeCost = colors.gray(
        `${(performance.now() - task.startTime).toFixed(2)}ms`,
      );
      this._stopLongPhase(task);
      task.disableTimeoutReport();
      this.#running--;
      task.status = e ? TaskStatus.ERROR : TaskStatus.DONE;
      this._removeTask(task);

      if (e) {
        task.defer.reject(e);
      } else {
        task.defer.resolve();
      }

      task.parent.onChildFinished(e);

      if (e) {
        console.log(
          `${colors.red("error")} ${name} ${timeCost}${
            this._formatGroupPercent(task.parent)
          }`,
        );
      } else {
        console.log(
          `${colors.green("finished")} ${name} ${timeCost}${
            this._formatGroupPercent(task.parent)
          }`,
        );
      }

      Promise.resolve().then(() => this.run());
    };

    runner.then(() => finish(), finish);
  }

  private _formatGroupPercent(task: TreeNode | null) {
    if (!task) {
      return "";
    }

    if (task instanceof GroupNode && task.bailout) {
      return colors.gray(`(${task.childFinished}/${task.totalChildren})`);
    }

    return colors.gray(
      `(${task.childFinished}/${
        task.childError
          ? colors.red(String(task.childError))
          : task.childError
      }/${task.totalChildren})`,
    );
  }

  private changeParallel(delta: number) {
    // 扩张的话无需设置上限，因为扩张说明任务的所有权已经移交出去了
    this.#parallel = Math.max(this.#parallel + delta, this.#minParallel);
    Promise.resolve().then(() => this.run());
  }

  private _queue(
    parent: TaskNode | null,
    name: string,
    exe: TaskExecutor,
  ): Promise<void> {
    const task = new TaskNode(name, exe, parent || this.#root);
    this._addTask(task);
    this.run();

    return task.defer;
  }

  private _queueGroup(
    parent: TreeNode | null,
    name: string,
    exeMap: GroupTaskExecutor,
    bailout = false,
  ): Promise<void> {
    const group = new GroupNode(name, parent || this.#root, bailout);

    for (const [key, exe] of Object.entries(exeMap)) {
      group.addChild(new TaskNode(key, exe, group));
    }

    this._addTask(group);
    this.run();

    return group.defer;
  }

  private _addTask(task: TreeNode) {
    const parent = task.parent;

    parent.addChild(task);
  }

  private _removeTask(task: TaskNode) {
    const parent = task.parent;
    parent.removeTask(task);

    if (task.child) {
      const root = this.#root;
      let last = task.child;
      while (last.sibling) {
        last.parent = root;
        root.totalChildren += 1;
        last = last.sibling;
      }
      last.parent = root;
      root.totalChildren += 1;
      last.sibling = root.child;
      root.child = task.child;
    }
  }

  private getDisplayName(node: TreeNode) {
    return readableDisplayNames(node.displayNames);
  }
}

enum TaskStatus {
  WAITING,
  RUNNING,
  ERROR,
  DONE,
}

interface TaskContext {
  queue(name: string, executor: TaskExecutor): void;
  queueChild(name: string, executor: TaskExecutor): void;
  readonly parent: Readonly<Task> | null;
  readonly task: Readonly<Task>;
}

export type TaskExecutor = (
  context: TaskContext,
) => Promise<void | ((children: ChildTasksStatus) => void)>;

interface Task {
  name: string;
  status: TaskStatus;
  executor: TaskExecutor;
  parent: Task | null;
  childCount: number;
  childErrorCount: number;
  childFinished: number;
  finisher: null | ((children: ChildTasksStatus) => void);
}

interface ChildTasksStatus {
  count: number;
  error: number;
  success: number;
}

interface SyncQueueOptions {
  parallel?: number
  longTaskTimeout?: number
  maxParallel?: number
}

export function createTask(
  name: string,
  exe: TaskExecutor,
  parent: Task | null = null,
): Task {
  return {
    name,
    executor: exe,
    status: TaskStatus.WAITING,
    parent,
    childCount: 0,
    childFinished: 0,
    childErrorCount: 0,
    finisher: null,
  };
}

export class SyncQueue {
  static DEFAULT_PARALLEL = 8
  static MAX_PARALLEL = 32
  static DEFAULT_TIMEOUT = 30 * 1000

  private minParallel: number;
  private maxParallel: number
  private parallel: number
  private longTaskTimeout: number
  private running = 0;
  private tasks: Task[] = [];

  constructor(options: SyncQueueOptions = {}) {
    this.parallel = this.minParallel = options.parallel || SyncQueue.DEFAULT_PARALLEL
    this.maxParallel = options.maxParallel || SyncQueue.MAX_PARALLEL
    this.longTaskTimeout = options.longTaskTimeout || SyncQueue.DEFAULT_TIMEOUT
  }

  queue(name: string, executor: TaskExecutor) {
    this.tasks.push(createTask(name, executor));
    this.runNext();
  }

  runNext() {
    for (const task of this.tasks) {
      if (this.running >= this.parallel) {
        break
      }
      if (task.status === TaskStatus.WAITING) {
        this.run(task)
      }
    }
  }

  private run(task: Task) {
    this.running++;
    task.status = TaskStatus.RUNNING;
    console.log(`Start task: ${task.name}`);
    const result = Promise.resolve().then(() => task.executor({
      queue: this.queue.bind(this),
      queueChild: this.queueChild.bind(this, task),
      parent: task.parent,
      task,
    }));
    let isLongTask = false

    const timer = setTimeout(() => {
      console.warn(`* Task ${task.name} running over 30s`);
      isLongTask = true
      this.changeParallel(1)
    }, 30 * 1000); // 30s

    const finish = () => {
      clearTimeout(timer);
      this.running--;
      this.tasks.splice(this.tasks.indexOf(task), 1);
      if (task.parent) {
        this.finishChildTask(task.parent);
      }
      if (isLongTask) {
        this.changeParallel(-1)
      }
      Promise.resolve().then(() => this.runNext());
    };

    result.then((finisher) => {
      task.status = TaskStatus.DONE;
      if (finisher) {
        task.finisher = finisher;
      }
      finish();
      console.log(
        `${this.formatChildPercent(task.parent)}Task finished: ${task.name}`,
      );
    }, (e) => {
      task.status = TaskStatus.ERROR;
      if (task.parent) {
        task.parent.childErrorCount++;
      }
      finish();
      // TODO: clean all child
      console.error(
        `${this.formatChildPercent(task.parent)}Task error: ${task.name}`,
      );
      console.error(e && e.message);
    });
  }

  private queueChild(parentTask: Task, name: string, executor: TaskExecutor) {
    if (parentTask.status !== TaskStatus.RUNNING) {
      console.warn("Cannot queue child task when parent task is not running");
      return;
    }
    const parentIndex = this.tasks.indexOf(parentTask);
    // if has parent task, insert task after parent task
    this.tasks.splice(
      parentIndex === -1 ? this.tasks.length : parentIndex,
      0,
      createTask(name, executor, parentTask),
    );
    parentTask.childCount++;
    this.runNext();
  }

  private finishChildTask(task: Task) {
    task.childFinished++;
    if (task.childCount === task.childFinished) {
      if (task.finisher) {
        this.tasks.unshift(
          createTask(`${task.name}:finisher`, async () =>
            await task.finisher!({
              count: task.childCount,
              error: task.childErrorCount,
              success: task.childFinished - task.childErrorCount,
            })),
        );
      }
      if (task.parent) {
        if (task.childErrorCount) {
          task.parent.childErrorCount++;
        }
        this.finishChildTask(task.parent);
      }
    }
  }

  private formatChildPercent(task: Task | null) {
    if (task === null) {
      return "";
    }

    return `(${task.childFinished}/${task.childCount}) `;
  }

  private changeParallel(delta: number){
    this.parallel = Math.min(Math.max(this.parallel + delta, this.minParallel), this.maxParallel)
    this.runNext()
  }
}

import { TaskExecutor, TaskManager } from "./manager.ts";
import { async, asserts } from "../deps.ts";

let tm: TaskManager;

function setup() {
  tm = new TaskManager();
}

Deno.test("normal usage", async () => {
  setup();
  await tm.queue("test", () => {});
});

Deno.test('too many long task', async () => {
  tm = new TaskManager({parallel: 1});

  const defer = async.deferred()
  let count = 0

  const longTask: TaskExecutor = async ({startLongPhase, stopLongPhase, task}) => {
    startLongPhase()
    count += 1
    await tm.queue(`${task.name}:child`, async () => {
      await async.delay(50)
    })
    count += 1
    stopLongPhase()
  }

  const promises: any[] = []
  for (let i = 0; i < 10; i++) {
    promises.push(tm.queue(`long-task:${i}`, longTask))
  }

  await async.delay(100)
  defer.resolve()

  await tm.waitAllFinished()
  asserts.assertEquals(count, 20)
})

Deno.test("wait child", async () => {
  setup();
  let step = "";
  await tm.queue("parent", async () => {
    step += "a";
    await tm.queue("child", async () => {
      step += "b";
      await async.delay(100);
      step += "c";
    });
    step += "d";
  });

  asserts.assertEquals(step, "abcd");
});

Deno.test("enable long phase", async () => {
  tm = new TaskManager({
    parallel: 2,
  });

  let step = "";
  await tm.queue("parent", async ({ startLongPhase, stopLongPhase }) => {
    step += "p";
    tm.queue("child1", async () => {
      step += "c";
      await async.delay(100);
      step += "d";
    });
    tm.queue("child2", async () => {
      step += "d";
    });
    startLongPhase();
    await async.delay(50);
    stopLongPhase();
    step += "e";
  });
  asserts.assertEquals(step, "pcde");

  await tm.waitAllFinished();
});

Deno.test("group", async () => {
  tm = new TaskManager({
    parallel: 2,
  });

  const newExe = () =>
    async () => {
      step += "y";
      await async.delay(50);
    };

  const newError = () =>
    async () => {
      step += "n";
      await async.delay(50);
      throw new Error();
    };

  let step = "";
  await tm.queueGroup("group-all-success", {
    a: newExe(),
    b: newExe(),
    c: newExe(),
  });
  asserts.assertEquals(step, "yyy");

  step = "";
  await tm.queueGroup("group-some-error", {
    a: newExe(),
    b: newExe(),
    c: newError(),
    d: newExe(),
    e: newExe(),
    f: newExe(),
  }).catch(() => {});
  asserts.assertEquals(step, "yynyyy");
});

Deno.test("group bailout", async () => {
  tm = new TaskManager({
    parallel: 1,
  });

  let step = "";
  await tm.queueGroup("group-bailout", {
    a: () => {
      step += "e";
      throw new Error();
    },
    b: () => {
      step += "e";
    },
  }, true).catch(() => {});

  asserts.assertEquals(step, "e");
});

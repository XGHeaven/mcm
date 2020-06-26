import { asserts } from './deps.ts'
import { matchVersion, parseVersionMatcher } from "./utils.ts";

Deno.test('parseVersionMatcher', () => {
  const tests: Array<[string, string[], string[]?]> = [
    ['1.14', ['1.14'], ['1.14.4', '1.14-pre', 'ashkdh']],
    ['1.14-rc', ['1.14-rc1', '1.14-rc2', '1.14-rc100'], ['1.14.1-rc1', '1.14-rc', '2-rc1', '1.16-rc9']],
    ['1.14-pre', ['1.14-pre1', '1.14-pre11'], ['1.14.1-pre1', '1.14-pre', '1.16-pre2']],
    ['1.14.*', ['1.14.1', '1.14.2', '1.14.3', '1.14'], ['1.14.1-pre', '1.13']],
    // 混合
    ['1.14.*-pre', ['1.14-pre1', '1.14.1-pre2', '1.14.2-pre3'], ['1.14', '1.14-pre', '1.13']]
  ]

  for (const [expr, trueCases, falseCases] of tests) {
    const matcher = parseVersionMatcher(expr)

    for (const trueCase of trueCases) {
      asserts.assert(matchVersion(trueCase, matcher), `"${expr}" should match ${trueCase}`)
    }

  if (falseCases) {
    for (const falseCase of falseCases) {
      asserts.assert(!matchVersion(falseCase, matcher), `"${expr}" should not match ${falseCase}`)
    }
  }

  }
})

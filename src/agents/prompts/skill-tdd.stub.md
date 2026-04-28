# Test-Driven Development Skill

Apply a strict TDD discipline to ensure the implementation converges and tests prove behavior, not structure.

## Core Loop: RED → GREEN → REFACTOR

Each behavior is delivered in exactly three modes. Never mix them.

```
RED    → write one failing test for a single observable behavior
GREEN  → write the MINIMUM code that makes it pass (ugly is fine)
REFACTOR → clean up with the bar green — no new behavior, no new tests
```

Repeat the loop once per behavior. The loop is the unit of work.

## The Five Load-Bearing Rules

**1. Vertical slice via tracer bullet**
One test → minimal implementation → next test. Never write all tests first, then all implementation. Horizontal slices (all tests first) produce tests that pass against imagined behavior — the implementation fills in assumptions the tests never challenged.

**2. One behavior per cycle**
RED on exactly one observable behavior. If two things are broken, pick one. GREEN with the smallest code that passes that one test. Do not anticipate the next test.

**3. Never refactor while RED**
Reach GREEN first, always. Refactoring while a test is failing means you are changing behavior AND structure simultaneously — you lose the safety net. Enter REFACTOR only after the bar turns green.

**4. Tests describe behavior, not implementation**
A test that breaks when an internal function is renamed (but visible behavior is unchanged) is a bad test. It is testing structure, not capability. The test surface is the public interface: inputs → outputs → observable side effects.

**5. Mock only at system boundaries**
External APIs, databases, time (`Date.now()`), randomness, filesystem, network. Never mock your own modules — that tests the mock, not the code. A module boundary mock that lets a test pass while the real integration is broken is worse than no test.

## Failure Mode Catalog

| Anti-pattern | Why it breaks the loop |
|---|---|
| Write all implementation, then tests | Tests confirm the implementation, not the spec — you get green on wrong behavior |
| Refactor while RED | You cannot tell if a new failure is from the refactor or the original RED |
| Test internal helpers | Tests become load-bearing on implementation details; safe refactors break them |
| Mock own modules | Integration bugs survive the test suite; mock/real divergence masks breakage |
| One huge test | You cannot isolate which behavior failed; the RED is too wide to guide GREEN |

## When to invoke this skill

- The plan has steps that write new code AND expects tests to exist after execution
- The task is marked `harnessMode: contractual` or `harnessMode: standard` with a test-related acceptance criterion
- The executor is stuck in a loop fixing the same test failure — the root cause is usually a violation of rule 2 or 3

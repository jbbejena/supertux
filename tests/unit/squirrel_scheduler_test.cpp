// SPDX-License-Identifier: GPL-3.0-or-later
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <iostream>
#include <simplesquirrel/simplesquirrel.hpp>
#include "squirrel/squirrel_random.hpp"
#include "squirrel/squirrel_scheduler.hpp"
#include "supertux/level.hpp"
#include "util/log.hpp"

// This fixture has no game/renderer; exercise the actual scheduler and VM.
Level* Level::s_current = nullptr;
LogLevel g_log_level = LOG_WARNING;
static int errors = 0;
std::ostream& log_warning_f(const char*, int) { ++errors; return std::cerr; }
static SquirrelScheduler* scheduler = nullptr;
static SQInteger wait_until(HSQUIRRELVM vm)
{
  SQFloat wake = 0;
  assert(SQ_SUCCEEDED(sq_getfloat(vm, 2, &wake)));
  return scheduler->schedule_thread(vm, wake, false);
}
static bool flag(HSQUIRRELVM vm, const char* name)
{
  sq_pushroottable(vm); sq_pushstring(vm, name, -1);
  assert(SQ_SUCCEEDED(sq_get(vm, -2)));
  SQBool value = SQFalse;
  assert(SQ_SUCCEEDED(sq_getbool(vm, -1, &value)));
  sq_pop(vm, 2); return value != SQFalse;
}
int main()
{
  ssq::VM vm(128);
  SquirrelScheduler actual(vm); scheduler = &actual;
  auto handle = vm.getHandle();
  sq_pushroottable(handle); sq_pushstring(handle, "wait_until", -1);
  sq_newclosure(handle, wait_until, 0); sq_newslot(handle, -3, SQFalse); sq_pop(handle, 1);
  vm.run(vm.compileSource(R"(
    done_a <- false; done_b <- false;
    first <- newthread(function() {
      wait_until(10.0);
      second <- newthread(function() {wait_until(5.0); done_b = true;});
      second.call();
      wait_until(40.0);
      done_a = true;
    });
    first.call();
  )"));
  actual.update(20);
  assert(flag(handle, "done_b"));
  assert(!flag(handle, "done_a"));
  assert(errors == 0);
  actual.update(41);
  assert(flag(handle, "done_a"));
  assert(errors == 0);

  Random expected;
  expected.seed(1); gameRandom.seed(1);
  vm.addFunc("rand", [](HSQUIRRELVM target) -> SQInteger {return squirrel_random(target, gameRandom);});
  vm.run(vm.compileSource(R"(
    random_values <- [];
    for (local i=0; i<64; ++i) {
      local value = rand();
      if (typeof value != "integer") throw "rand returned a non-integer";
      random_values.append(value);
      // The intro's bush movement performs this arithmetic after a wait.
      local offset = 3607.0 + (value % 6) - 3;
      if (offset < 3604 || offset > 3609) throw "invalid bush offset";
    }
  )"));
  sq_pushroottable(handle); sq_pushstring(handle, "random_values", -1);
  assert(SQ_SUCCEEDED(sq_get(handle, -2)));
  for (int i=0; i<64; ++i)
  {
    sq_pushinteger(handle, i); assert(SQ_SUCCEEDED(sq_get(handle, -2)));
    SQInteger value = 0; assert(SQ_SUCCEEDED(sq_getinteger(handle, -1, &value)));
    assert(value == expected.rand()); sq_pop(handle, 1);
  }
  sq_pop(handle, 2);
}

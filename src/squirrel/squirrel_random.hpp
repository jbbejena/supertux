// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include <squirrel.h>
#include "math/random.hpp"

// SimpleSquirrel reserves SQInteger returns for native stack-result counts.
// On 32-bit targets, int aliases SQInteger: explicitly push the random value.
inline SQInteger squirrel_random(HSQUIRRELVM vm, Random& random)
{
  sq_pushinteger(vm, random.rand());
  return 1;
}

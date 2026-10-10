# Will eventually handle game tests here too
include(CTest)
set(all_test_targets "")

if(EMSCRIPTEN)
  # Unit programs run in Node, without the game's DOM shell or asset preload.
  # The parent directory's linker flags are for the playable HTML executable.
  set(CMAKE_EXECUTABLE_SUFFIX .js)
  set(CMAKE_EXE_LINKER_FLAGS "-sDISABLE_EXCEPTION_CATCHING=0 -sENVIRONMENT=node -sALLOW_MEMORY_GROWTH=1")
  if(CMAKE_BUILD_TYPE MATCHES Debug)
    string(APPEND CMAKE_EXE_LINKER_FLAGS " -fsanitize=undefined -sSAFE_HEAP=1 -sASSERTIONS=1")
  endif()
endif()

function(make_unit_test test_name)
  cmake_parse_arguments(PARSE_ARGV 1 mtargs
    "NO_PREPEND_SRC" "" "SOURCE;EXTERNAL;LIBRARIES;DEFINITIONS;INCLUDES")
  # EXTERNAL is just more readable for external source files we use
  if (NOT mtargs_NO_PREPEND_SRC)
    list(TRANSFORM mtargs_EXTERNAL PREPEND ${SUPERTUX_SOURCE_DIR}/src/)
  endif()
  add_executable(${test_name} ${mtargs_SOURCE} ${mtargs_EXTERNAL})
  target_compile_features(${test_name} PRIVATE cxx_std_17)
  target_include_directories(${test_name} PUBLIC ${SUPERTUX_SOURCE_DIR}/src ${mtargs_INCLUDES})
  if (mtargs_DEFINITIONS)
    target_compile_definitions(${test_name} PUBLIC ${mtargs_DEFINITIONS})
  endif()
  if (mtargs_LIBRARIES)
    target_link_libraries(${test_name} PUBLIC ${mtargs_LIBRARIES})
  endif()
  set(all_test_targets "${all_test_targets};${test_name}" PARENT_SCOPE)
  add_test(NAME ${test_name}
    COMMAND ${test_name})
endfunction(make_unit_test)

make_unit_test(MD5Test SOURCE md5_test.cpp
  EXTERNAL addon/md5.cpp)

make_unit_test(AATriangleTest SOURCE aatriangle_test.cpp
  EXTERNAL math/aatriangle.cpp
  LIBRARIES SDL3 glm DEFINITIONS GLM_ENABLE_EXPERIMENTAL)

make_unit_test(CollisionTest SOURCE collision_test.cpp
  EXTERNAL math/rectf.cpp
  LIBRARIES SDL3 glm DEFINITIONS GLM_ENABLE_EXPERIMENTAL)

make_unit_test(RemoteControllerTest SOURCE remote_controller_test.cpp
  EXTERNAL control/controller.cpp control/remote_controller.cpp
  INCLUDES ${CMAKE_BINARY_DIR})

make_unit_test(SquirrelSchedulerTest SOURCE squirrel_scheduler_test.cpp
  EXTERNAL squirrel/squirrel_scheduler.cpp video/color.cpp
  LIBRARIES simplesquirrel_static SDL3 glm
  INCLUDES ${CMAKE_BINARY_DIR}
    ${SUPERTUX_SOURCE_DIR}/external/simplesquirrel/libs/squirrel/include)

message("ALL TESTS: ${all_test_targets}")

add_custom_target(supertux-unit-tests
  COMMAND ${CMAKE_CTEST_COMMAND} -C $<CONFIG> --output-on-failure
  DEPENDS ${all_test_targets}
  WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
if(NOT TARGET tests)
  add_custom_target(tests DEPENDS supertux-unit-tests)
endif()

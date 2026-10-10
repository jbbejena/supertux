//  SuperTux
//  Copyright (C) 2021 A. Semphris <semphris@protonmail.com>
//
//  This program is free software: you can redistribute it and/or modify
//  it under the terms of the GNU General Public License as published by
//  the Free Software Foundation, either version 3 of the License, or
//  (at your option) any later version.
//
//  This program is distributed in the hope that it will be useful,
//  but WITHOUT ANY WARRANTY; without even the implied warranty of
//  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//  GNU General Public License for more details.
//
//  You should have received a copy of the GNU General Public License
//  along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Export functions for emscripten
// Export functions through EMSCRIPTEN_KEEPALIVE or CMakeLists.txt.
#ifdef __EMSCRIPTEN__

#include <emscripten.h>
#include <emscripten/html5.h>

#include "addon/downloader.hpp"
#include "gui/menu_manager.hpp"
#include "supertux/gameconfig.hpp"
#include "supertux/globals.hpp"
#include "supertux/screen_manager.hpp"
#include "video/video_system.hpp"

extern "C" {

void set_resolution(int w, int h);
void save_config();
void set_browser_suspended(int suspended);
void reset_browser_input();
void set_browser_touch_available(int available);
void cancel_browser_touch(int pointer_id);
int get_browser_menu_state();
void init_emscripten();
void onDownloadProgress(intptr_t address, int id, int loaded, int total);
void onDownloadFinished(intptr_t address, int id, const char* data);
void onDownloadError(intptr_t address, int id);
void onDownloadAborted(intptr_t address, int id);
const char* getExceptionMessage(intptr_t address);

EMSCRIPTEN_KEEPALIVE // This is probably not useful, I just want ppl to know it exists
void
set_resolution(int w, int h)
{
  if (w <= 0 || h <= 0 ||
      (g_config->window_size == Size(w, h) && VideoSystem::current()->get_window_size() == Size(w, h)))
    return;
  VideoSystem::current()->on_resize(w, h);
  ScreenManager::current()->on_window_resize();
}

void
set_browser_suspended(int suspended)
{
  ScreenManager::current()->set_browser_suspended(suspended != 0);
}

void
reset_browser_input()
{
  ScreenManager::current()->reset_browser_input();
}

EMSCRIPTEN_KEEPALIVE
int
get_browser_menu_state()
{
  // Read-only diagnostics: 1 = menu, 2 = transition, 4 = current/pending dialog.
  // A controller update alone does not mean a new menu accepts pointer input:
  // MenuManager::event ignores it until draw() finishes the transition.
  const auto manager = MenuManager::current();
  if (!manager) return 0;
  return (manager->is_active() ? 1 : 0) |
         (manager->is_transition_active() ? 2 : 0) |
         (manager->has_dialog() ? 4 : 0);
}

void
set_browser_touch_available(int available)
{
  g_config->browser_touch_available = available != 0;
  if (g_config->browser_touch_controls == -1) g_config->mobile_controls = available != 0;
}

void
cancel_browser_touch(int pointer_id)
{
  // SDL3 maps browser pointer IDs to finger IDs by adding one.
  // Queue after any SDL DOWN/MOTION events already produced this turn.
  SDL_Event event{};
  event.type = SDL_EVENT_FINGER_CANCELED;
  event.tfinger.fingerID = static_cast<SDL_FingerID>(pointer_id) + 1;
  SDL_PushEvent(&event);
}

EMSCRIPTEN_KEEPALIVE // Same as above
void
save_config()
{
  g_config->save();
}

void
onDownloadProgress(intptr_t address, int id, int loaded, int total)
{
  reinterpret_cast<Downloader*>(address)->onDownloadProgress(id, loaded, total);
}

void
onDownloadFinished(intptr_t address, int id, const char* data)
{
  reinterpret_cast<Downloader*>(address)->onDownloadFinished(id, data);
}

void
onDownloadError(intptr_t address, int id)
{
  reinterpret_cast<Downloader*>(address)->onDownloadError(id);
}

void
onDownloadAborted(intptr_t address, int id)
{
  reinterpret_cast<Downloader*>(address)->onDownloadAborted(id);
}

const char*
getExceptionMessage(intptr_t address)
{
  return reinterpret_cast<std::exception*>(address)->what();
}

} // extern "C"

void
init_emscripten()
{
  EM_ASM({
    if (window.supertux_onready)
      window.supertux_onready();
  }, 0); // EM_ASM is a variadic macro and Clang requires at least 1 value for the variadic argument
}

#endif

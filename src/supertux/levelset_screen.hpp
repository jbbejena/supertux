//  SuperTux
//  Copyright (C) 2014 Ingo Ruhnke <grumbel@gmail.com>
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

#pragma once

#include <cstdint>
#include <optional>
#include <string>

#include "math/vector.hpp"
#include "supertux/screen.hpp"
#include "util/currenton.hpp"

class Savegame;

class LevelsetScreen final : public Screen,
                             public Currenton<LevelsetScreen>
{
private:
  std::string m_basedir;
  std::string m_level_filename;
  Savegame& m_savegame;
  bool m_level_started;
  bool m_solved;

public:
  LevelsetScreen(const std::string& basedir, const std::string& level_filename, Savegame& savegame,
                 const std::optional<std::pair<std::string, Vector>>& start_pos, bool skip_intro = false);

  virtual void draw(Compositor& compositor) override;
  virtual void update(float dt_sec, const Controller& controller) override;

  virtual void setup() override;
  virtual void leave() override;

  virtual IntegrationStatus get_status() const override;

  void finished_level(bool win);

#ifdef __EMSCRIPTEN__
  void hold_coop_result(uint32_t session, uint32_t epoch, int level, bool win);
  bool start_coop_level(uint32_t session, uint32_t epoch, int level);
#endif

private:
  std::optional<std::pair<std::string, Vector>> m_start_pos;
  bool m_skip_intro;

#ifdef __EMSCRIPTEN__
  uint32_t m_coop_session = 0;
  uint32_t m_coop_epoch = 0;
  int m_coop_level = 0;
  bool m_coop_win = false;
  bool m_coop_ready = false;
#endif

  LevelsetScreen(const LevelsetScreen&) = delete;
  LevelsetScreen& operator=(const LevelsetScreen&) = delete;
};

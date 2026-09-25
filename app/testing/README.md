# TriviaForge Testing Suite

Automated testing framework for TriviaForge trivia application.

## 📁 Directory Structure

```
testing/
├── README.md                    # This file
├── TESTING.md                   # Complete testing guide and documentation
├── test-runner.js              # Main automated test runner
├── stress-test.config.js       # Stress test scenario configurations
├── rounds-test.js              # Socket.IO integration test for quizzes with rounds
├── component/                  # Component/logic tests (no server needed) - see below
└── e2e/                        # End-to-end tests in a real browser and over sockets - see below
└── logs/                       # Test execution logs (future)
```

## 🧪 Rounds feature tests

Three layers, from fastest to most thorough. All are plain Node scripts (no test framework), print
`✅`/`❌` per check and exit non-zero on failure.

| Command (from `app/`) | What it covers | Needs |
|---|---|---|
| `npm run test:component` | Podium ties, round components (SSR), admin round handlers with a fake backend | Nothing (no server, DB or browser) |
| `npm run test:rounds` | The round socket protocol: answer-leak scan, timers, races, presenter-only controls, resume, persistence | A running server |
| `npm run test:e2e` | The real UI in headless Chrome (player, presenter, display, admin drag and drop, joining, reconnecting) plus a round-less quiz and the client composable | A running server and Chrome |

### Setting up for `test:rounds` and `test:e2e`

1. **Run a server you can throw data at**, ideally not your real one. The tests create their own
   quizzes and rooms and remove them afterwards (they never touch anything they didn't create), but
   they do write to the database and start real live rooms. A scratch database is a good idea:
   ```bash
   createdb triviaforge_test
   DATABASE_URL=postgres://you@localhost:5432/triviaforge_test \
   APP_PORT=3100 SERVER_URL=http://localhost:3100 \
   DEBUG_MODE=true NODE_ENV=development ADMIN_PASSWORD=testadmin123 CSRF_SECRET=test \
   node server.js
   ```
   (Build the frontend first with `npx vite build`, as the server serves `app/dist`. Rebuild after
   frontend changes and restart after server changes.)
2. **`DEBUG_MODE=true` is strongly recommended.** Otherwise the login endpoint is rate limited and the
   many logins and joins can trip the limits. On a shared server, raise `SOCKET_JOIN_LIMIT` and
   `SOCKET_ANSWER_LIMIT` instead.
3. **Chrome or Chromium** for the browser suites. It's found automatically on macOS/Windows/Linux, or
   set `CHROME_PATH`. Without it `test:e2e` skips the browser suites and says so loudly.
4. Point the tests at the server:

   | Variable | Default | |
   |---|---|---|
   | `TEST_BASE_URL` | `http://localhost:3000` | Server under test |
   | `TEST_ADMIN_USER` / `TEST_ADMIN_PASSWORD` | `admin` / `changeme` | Must match the server's admin login |
   | `TEST_ADMIN_TOKEN` | (login) | Reuse an existing login token (the runner does this for you) |
   | `CHROME_PATH` | (auto-detect) | Chrome/Chromium binary |
   | `TEST_ARTIFACTS_DIR` | system temp `/triviaforge-e2e` | Where failure screenshots are written |
   | `DATABASE_URL` | (unset) | Optional, lets `test:rounds` also verify what was persisted |

```bash
cd app
TEST_BASE_URL=http://localhost:3100 TEST_ADMIN_PASSWORD=testadmin123 npm run test:e2e
npm run test:e2e -- reconnect         # only suites whose file name contains "reconnect"
npm run test:e2e -- --no-browser      # skip the suites that need Chrome
TEST_BASE_URL=... node testing/e2e/admin-authoring.e2e.js   # a single suite
```

**Server modes.** The join suite adapts to `GUEST_ONLY_MODE` (normal join form when off, display-name-only form when on) and the solo suite adapts to `SOLO_MODE`. To cover both settings, run those suites twice, the second time against a server started with the flag set (for example `npm run test:e2e -- join` and `npm run test:e2e -- solo`). The other suites work in any mode.

### The e2e suites (`testing/e2e/`)

| Suite | Covers |
|---|---|
| `player-round-flow` | Player's round screen: selection highlight, progress modal, no-confirm submit, resubmitting, unsent-change warning, refresh mid-round, timed auto-submit |
| `results-and-standings` | Leaderboards between rounds, final standings withheld until completion (screen and wire), podium ties, full leaderboard, results surviving a refresh, late joiners |
| `join-and-identity` | Unique display names, races, keeping the original name, QR link behaviour, guest-only vs normal join form |
| `reconnect` | Refresh shows "Reconnecting" instead of the landing page, fallback when the room is closed or the server is unreachable, leaving on purpose |
| `admin-authoring` | Round headers/badge, rename keeps the time limit, drag questions within and between rounds with the drop indicators |
| `solo-mode` | Solo play exists only with `SOLO_MODE=true`: links, `/solo` page, quiz badges and `/api/solo` all disappear when it's off (adapts to the server's mode) |
| `presenter-display-flow` | A whole two-round quiz through the presenter page, a phone, bots and the display page |
| `legacy-live-game` | A quiz without rounds plays as before; short answers graded; rejoining a completed room (sockets only) |
| `use-rounds-composable` | The client `useRounds` composable against real sockets (no browser) |

Shared plumbing is in `e2e/lib/`: `harness.js` (suite runner, quiz/room/bot/page helpers, cleanup),
`cdp.js` (a small Chrome DevTools Protocol client, no dependencies beyond Node 22) and `config.js`.

Tips when writing or debugging a browser test:
- On failure a suite screenshots every open tab into `TEST_ARTIFACTS_DIR`.
- `innerText` reflects CSS `text-transform`, so `page.waitText`/`has` match case-insensitively.
- `v-show` leaves hidden elements in the DOM: use `page.visible(selector)`, not existence.
- Background tabs pause animations and `requestAnimationFrame`, so open tabs you assert on in the foreground.
- Two tabs with the same player ID are blocked by the multi-tab guard; use one browser tab per player.

## 🚀 Quick Start

### From Project Root

```bash
# Windows
test.bat quick              # Fast test (3 players)
test.bat session            # Default test (5 players)
test.bat stress             # Stress test (20 players)

# Linux/Mac
./test.sh quick
./test.sh session
./test.sh stress
```

### From Docker Container

```bash
# Enter container
docker-compose exec app sh

# Run tests
npm run test:quick
npm run test:session
npm run test:stress
npm run test:verbose
```

### Custom Test Scenarios

```bash
# From container
TEST_PLAYERS=30 TEST_QUESTIONS=10 node testing/test-runner.js

# Or use environment variables
TEST_PLAYERS=15 npm run test:session
```

## 📊 Available Test Scenarios

Defined in [stress-test.config.js](stress-test.config.js):

| Scenario | Players | Questions | Duration | Use Case |
|----------|---------|-----------|----------|----------|
| `quick` | 3 | 2 | ~10s | Fast development iteration |
| `light` | 5 | 3 | ~25s | Small group testing |
| `medium` | 15 | 5 | ~45s | Average party/event |
| `heavy` | 25 | 10 | ~2min | Large event (like Metrica) |
| `extreme` | 50 | 10 | ~3min | Maximum capacity test |
| `marathon` | 10 | 50 | ~10min | Full quiz validation |
| `debug` | 5 | 3 | ~25s | Detailed logging |
| `chaos` | 20 | 5 | ~1min | Connection stability test |

## 🛠️ Configuration

### Environment Variables

```bash
TEST_SERVER_URL=http://localhost:3000    # Server URL
TEST_QUIZ_ID=1                           # Quiz to test with
TEST_PLAYERS=5                           # Number of players
TEST_ANSWER_DELAY=2000                   # Max delay between answers (ms)
TEST_QUESTION_DELAY=5000                 # Delay between questions (ms)
TEST_DISCONNECTS=false                   # Simulate disconnections
TEST_VERBOSE=false                       # Detailed logging
```

### Adding New Scenarios

Edit [stress-test.config.js](stress-test.config.js):

```javascript
export const stressTestScenarios = {
  myCustomTest: {
    name: 'My Custom Test',
    players: 20,
    questions: 5,
    answerDelay: 2000,
    questionDelay: 5000,
    disconnects: false,
    verbose: false,
    description: 'Testing my new feature'
  }
};
```

## 📈 Scaling Guidelines

1. **Development**: Use `quick` test for rapid iteration
2. **Feature Testing**: Create custom scenario in `stress-test.config.js`
3. **Pre-Deployment**: Run `medium` and `heavy` tests
4. **Production Validation**: Run `extreme` before major events
5. **Debugging**: Use `debug` scenario for detailed logs

## 🔍 Test Components

### test-runner.js

Main test orchestrator that:
- Creates test rooms via debug API
- Simulates multiple players joining
- Presents questions and collects answers
- Validates results
- Cleans up test data

### stress-test.config.js

Centralized configuration for:
- Predefined test scenarios
- Feature-specific test templates
- Custom scenario builder
- Scaling recommendations

## 📚 Documentation

See [TESTING.md](TESTING.md) for:
- Detailed usage instructions
- Troubleshooting guide
- Understanding test output
- Advanced usage examples
- CI/CD integration

## 🎯 Adding Tests for New Features

When you add a new feature:

1. **Define a test scenario** in `stress-test.config.js`:
   ```javascript
   featureTests: {
     myNewFeature: {
       name: 'My New Feature Test',
       players: 10,
       questions: 5,
       // ... configuration
     }
   }
   ```

2. **Update test-runner.js** if needed for feature-specific testing

3. **Document the test** in TESTING.md

4. **Add to CI/CD pipeline** if applicable

## 🐛 Debugging Tests

Enable verbose mode:

```bash
TEST_VERBOSE=true npm run test:session
```

Check server logs:

```bash
docker-compose logs -f app
```

Inspect database state:

```bash
docker-compose exec db psql -U trivia -d trivia
```

## ✅ Pre-Deployment Checklist

- [ ] Run `quick` test to validate basic functionality
- [ ] Run `light` test for typical use case
- [ ] Run `heavy` test to simulate your target audience size
- [ ] Run `extreme` test to validate capacity limits
- [ ] Check logs for warnings or errors
- [ ] Validate database connection pooling

---

**Happy Testing!** 🚀

For questions or issues, see the main [README.md](../../README.md)

# TriviaForge Roadmap

Completed feature history and planned future work. For active/in-progress development tracking, see [TODO.md](TODO.md). For setup and usage, see [README.md](README.md).

## Completed Features

**v5.16.0 (Sep 2026) - Multiple Rounds**
- [x] Quizzes can be split into rounds with any number of questions each; rounds are optional, so existing quizzes play exactly as before
- [x] Admin editor: round headers with a title and optional time limit, a round selector on each question, reordering within a round, and drag-and-drop between rounds
- [x] Live play: players see every question of a round at once, answer at their own pace, and submit the round; in-progress answers are saved to the server so reconnects and timer expiry never lose them
- [x] Rounds are timed (they end on their own, auto-submitting what players have) or untimed (the presenter ends them, with a live "submitted X of N" view)
- [x] Correct answers are revealed only after a round ends and are never sent to players while it is open
- [x] Leaderboard shown between rounds to everyone in the room: players' devices, the presenter and the display page
- [x] Rounds survive session resume, JSON library export/import, session history (per-round headings), CSV (Round column) and PDF exports
- [x] Fixed final-results scoring, which never counted correct short-answer questions, and resume, which lost typed short-answer text
- [x] Socket.IO integration test for the round flow (`npm run test:rounds`)

**v5.15.0 (Jul 2026) - Open-Ended (Short Answer) Questions**
- [x] New `short_answer` question type — players type a free-text answer instead of picking from choices
- [x] Automatic grading via fuzzy string matching (Levenshtein-based similarity) against admin-supplied accepted answers/synonyms
- [x] Admin-configurable match strictness threshold in Quiz Options (default 85% similarity)
- [x] Question Editor support: "Open-Ended / Short Answer" type with a reusable accepted-answers list (reuses the existing choice-list UI)
- [x] Player-facing single-line text input with confirm-before-submit, plus a separate timeout auto-submit path that submits whatever's currently typed (only a truly empty field counts as no answer)
- [x] Live multiplayer, solo play, presenter session breakdown, and CSV/PDF export all support the new question type end-to-end

**v5.14.0 (Jul 2026) - Postgres 18, Dependency Updates & Backup File Import**
- [x] Upgraded `docker-compose.yml` from `postgres:15` to `postgres:18` and the app base image from `node:22-alpine` to `node:24-alpine`
- [x] Safe in-range npm dependency updates (Vite, Vue, pg, Express patch, and others); major-version bumps (Express 5, Pinia 4, Vue Router 5, etc.) deferred for a dedicated testing pass — see TODO.md
- [x] Backup file import — restore from a previously-downloaded `.sql.gz` on a freshly rebuilt instance, even without the original `backups` Docker volume
- [x] Imported backups show accurate app version, per-table row counts, and applied migrations, parsed directly from the dump's `schema_migrations` data (no live-database access needed)

**v5.12.0 (Jul 2026) - Database Backup & Quiz Library Export**
- [x] Automatic daily backups (2:00 AM) plus on-demand manual backups from the Admin panel
- [x] One-click restore with version-gated safety check (blocks restoring a newer backup onto an older app)
- [x] Download or delete individual backups; automatic pruning keeps the 10 most recent
- [x] Quiz library export as JSON (full library or a single quiz) or CSV (all questions)
- [x] Quiz library import with duplicate detection and per-item review

**v5.11.0 (Apr 2026) - PDF Session Export & GitHub Actions CI/CD**
- [x] Rich PDF session reports: summary page with podium (top-3 gold/silver/bronze), full leaderboard, per-question accuracy bar chart
- [x] Per-question pages: question text, embedded images (WebP/GIF/AVIF auto-converted to PNG), color-coded answer choices, player response grid
- [x] Bulk PDF export — multiple sessions downloaded as a ZIP archive (one PDF per session)
- [x] Export PDF buttons added alongside existing CSV buttons in session list and session detail modal
- [x] GitHub Actions CI/CD: auto-builds and pushes Docker image to Docker Hub on version tag push (`v*.*.*`)
- [x] Publishes both `:latest` and `:vX.Y.Z` tags to `emancodetemplar/triviaforge` on Docker Hub

**v5.10.5 (Apr 2026) - Auto-Pilot Fixes & Connection Optimization**
- [x] Fixed auto-pilot skipping the live question when starting mid-session
- [x] Fixed auto-pilot resume not correctly calculating remaining time after pause
- [x] Fixed answer reveal modal appearing twice when auto-mode and auto-reveal both active
- [x] Fixed "All players answered" banner stuck on presenter across question transitions
- [x] Fixed presenter losing auto-pilot control after page refresh (viewRoom now updates presenterId)
- [x] Prevented Display/spectator connections from creating ghost users in the database
- [x] Removed redundant app-level heartbeat (saves ~240 WebSocket messages/minute at 30 players)
- [x] Reduced socket pingTimeout from 360s to 60s — dead connections detected within ~85 seconds

**v5.10.4 (Mar 2026) - Display & Player UI Polish**
- [x] Fixed Display page content breaking words mid-character on small viewports
- [x] Display page now scales with vmin-based clamp() — never scrolls on any screen size
- [x] Fixed player choice text breaking mid-word (removed aggressive word-break)
- [x] Fixed player navbar question progress pill hidden on mobile (≤480px)
- [x] Player progress counter (X/Y) now updates correctly in real-time

**v5.10.3 (Mar 2026) - Auto-Pilot State Sync**
- [x] Auto-pilot timer and state now correctly sync to all connected clients on start
- [x] Presenter reconnection fully restores auto-mode state (timer, settings, active status)
- [x] Second browser/viewRoom no longer loses auto-mode UI
- [x] Session resume now includes auto-mode state in room restore payload

**v5.10.2 (Mar 2026) - Session & CSRF Resilience**
- [x] Sliding session expiry — sessions extend on activity, not fixed timeout from login
- [x] CSRF token auto-retry: expired tokens transparently refreshed and request retried once
- [x] Quiz settings no longer reset to defaults when a partial update is submitted

**v5.10.1 (Mar 2026) - CSRF & Import Bugfix**
- [x] Fixed CSRF token validation failures in Docker behind a proxy (trust proxy setting)
- [x] Fixed quiz import "Use Existing" option crashing with duplicate key error

**v5.10.0 (Mar 2026) - Unified Navbar Redesign**
- [x] Unified navbar design system across all 5 navbars with shared CSS classes
- [x] Admin/Presenter links visible on player-side pages when logged in as admin
- [x] Consistent right-aligned links, AppIcon on every link, active page underline
- [x] Hover: color change + subtle bottom border, danger links in red
- [x] Hamburger mobile menu with tight spacing, replaced emoji rank medals with AppIcon

**v5.9.0 (Mar 2026) - Trusted Devices & Score Fix**
- [x] "Remember this device for 30 days" checkbox on 2FA login - skips TOTP on trusted devices
- [x] Secure device token storage with 30-day expiry and periodic cleanup
- [x] Fixed `game_participants.score` always being 0 - now computes correct answer count on save
- [x] Guest participant scores also updated on re-save

**v5.8.0 (Mar 2026) - Player Stats Dashboard**
- [x] Dedicated `/stats` page for registered players with login required
- [x] Summary cards: total games, overall accuracy, best score, wins, avg rank, play streak
- [x] Accuracy and score trend charts (Chart.js + vue-chartjs) with theme-aware styling
- [x] Paginated game history table with type filter (all/solo/multiplayer)
- [x] Mobile-responsive layout with card view for small screens
- [x] "My Stats" navigation links from Player and Solo Play pages
- [x] Solo play now tracks user_id for authenticated players (enables stats)
- [x] Three new API endpoints: /api/stats/summary, /history, /charts

**v5.7.0 (Feb 2026) - Admin-Configurable Server URL**
- [x] Server Settings panel in Admin > Settings tab for configuring QR code URLs
- [x] Dynamic URL resolution: DB setting takes priority over env var over auto-detected IP
- [x] No container rebuild needed - changes take effect immediately for new QR codes
- [x] Fixed player auth redirect bug for expired tokens scanning QR codes

**v5.5.0 (Feb 2026) - Backend Performance & Session Health**
- [x] Backend Performance Optimizations - Memory cleanup scheduler, Socket.IO rate limiting, room activity tracking
- [x] Session Health Monitoring - Admin panel with memory usage, session counts, and live room statistics
- [x] Configurable Socket.IO Rate Limits - Environment variables for join and answer rate limits (NAT-friendly defaults)
- [x] Presenter Layout Improvements - Two-column layout for controls (buttons left, auto-mode right)
- [x] Memory Progress Bars - Color-coded visualization (green/yellow/red) based on usage percentage
- [x] Auto-refresh Toggle - 10-second interval for real-time monitoring

**v5.4.4 (Feb 2026) - Auto-Mode & Solo Play**
- [x] Auto-Mode Timer System - Server-side timers run independently of presenter's browser
- [x] Configurable question timer (10-120 seconds) and reveal delay (2-30 seconds)
- [x] Pause/Resume functionality with remaining time preservation
- [x] Auto-advance to next question after reveal delay
- [x] All players answered detection skips remaining question timer
- [x] Solo Play Mode - REST-based self-study without presenter
- [x] Solo quiz browser with solo-enabled quizzes only
- [x] Per-question countdown timer with immediate feedback
- [x] Results summary with per-question breakdown
- [x] Quiz visibility controls (available_live, available_solo flags)
- [x] Live/Solo badges on quiz list items with toggle controls
- [x] CountdownTimer component for player and display views

**v5.3.4 (Feb 2026) - Complete Duplicate Detection System**
- [x] Question Bank with centralized question management across all quizzes
- [x] Tag system with customizable colors for question organization
- [x] Question filtering by tag, type, archived status, and search text
- [x] Archive/restore questions with soft delete functionality
- [x] Find Duplicates tool with Levenshtein similarity algorithm (configurable threshold)
- [x] Ignore duplicate pairs feature for false positive management
- [x] Import duplicates review for bulk Excel imports with per-item decisions
- [x] Single question duplicate detection on save with warning modal
- [x] Question Details modal with metadata, quiz usage, and tag management
- [x] Add existing questions to quizzes directly from the Question Bank

**v5.2.2 (Feb 2026) - Lucide Icons & UI Polish**
- [x] Replaced all emojis with Lucide icons via Iconify for consistent UI
- [x] Created AppIcon wrapper component for standardized icon usage
- [x] Theme-aware icon colors across all components
- [x] Professional icon set throughout the application

**v5.2.1 (Jan 2026) - Quick Fixes**
- [x] Widened Account Settings modal for better usability
- [x] Removed placeholder PDF export (CSV is sufficient)

**v5.2.0 (Jan 2026) - Session Management & 2FA**
- [x] Two-Factor Authentication (TOTP) with QR code setup
- [x] Backup codes generation for 2FA recovery
- [x] Session filtering by date range, quiz name, and status
- [x] CSV export for individual and bulk sessions
- [x] Bulk session selection and deletion
- [x] Question images displayed in session details
- [x] Session breakdown with player responses per question

**v5.1.0 (Jan 2026) - Auto Database Migrations**
- [x] Version-based database migration system
- [x] Automatic schema updates on deployment
- [x] Dynamic migration file detection (no hardcoded list)
- [x] Fast startup when version unchanged (skips migration check)
- [x] Individual migration tracking prevents re-running
- [x] Idempotent migrations safe for existing databases

**v5.0.0 (Jan 2026) - Multi-Admin Support**
- [x] Media images now supported in questions via URL or local upload to container
- [x] True/False option added for questions
- [x] Multi-admin support with isolated quizzes and sessions per admin
- [x] Root admin can create/delete admin accounts and reset passwords
- [x] Session isolation - regular admins only see their own sessions
- [x] Session creator tracking - root admin sees who created each session
- [x] Account settings modal on Admin and Presenter pages
- [x] Password change with current password verification
- [x] Email address management for future recovery features
- [x] Presenter navbar dropdown matching Admin page style
- [x] User Management visual alignment improvements (CSS Grid)
- [x] Last seen timestamp fix including session token activity
- [x] Player disconnect immediately marks as disconnected

**v4.3.0 (Jan 2026) - Presenter Enhancements**
- [x] Real-time answer progress tracking with percentage and animated progress bar
- [x] All players answered notification banner with visual indicator
- [x] Auto-reveal functionality with 3-second countdown and cancel option
- [x] Configurable auto-reveal toggle (persists during session)
- [x] Smart player counting (excludes disconnected players)
- [x] Enhanced player status grouping (connected/away/disconnected)
- [x] Player count summary with color-coded icons

**v4.2.1 (Jan 2026) - Style Refactoring Release**
- [x] Component-first CSS architecture (Button, FormInput, Card enhancements)
- [x] Eliminated 560+ lines of duplicate CSS across 6 pages (12.5% reduction)
- [x] Theme-aware color system (zero hardcoded colors, perfect theme switching)
- [x] Centralized version management (single source of truth)
- [x] Extracted 4 shared CSS pattern files (navbars, scrollbars, badges, modals)
- [x] Migrated all 6 pages to use enhanced components
- [x] Perfect contrast across all 4 themes (dark, light, grey, system)

**v3.2.0 (Dec 2025) - Performance & Testing**
- [x] Enhanced connection stability (infinite reconnection attempts, 30s page visibility debounce)
- [x] Wake Lock API for mobile devices (prevents screen sleep)
- [x] Automated testing framework with 8 predefined scenarios (3-50 players)
- [x] Stress test configurations for scalable testing
- [x] Optimized logging (90% reduction in log volume)
- [x] Comprehensive testing documentation

**v3.0.0 (Nov 2025) - User Management & Session Persistence**
- [x] User authentication and accounts
  - Guest and registered player accounts
  - Session persistence with JWT tokens
  - Password reset functionality
  - User management interface
  - Recent rooms with active filtering

**v2.0.0 and earlier**
- [x] Real-time multiplayer trivia sessions
- [x] Admin panel with quiz management
- [x] Excel import/export functionality
- [x] QR code generation for quick joins
- [x] Session resume capability
- [x] PostgreSQL database integration
- [x] Docker containerization

## Future Features

**Under Consideration:**
- [ ] Advanced leaderboard and scoring systems
- [ ] Team mode for collaborative play
- [ ] Email verification for admin accounts *(on pause — email hosting not yet configured)*
- [ ] Internationalization (i18n)
- [ ] Custom scoring algorithms
- [ ] Powerups and game modifiers
- [ ] Performance monitoring and query optimization
- [ ] Ban Player Account system (permanent/temporary bans)
- [ ] Video/audio media support for questions

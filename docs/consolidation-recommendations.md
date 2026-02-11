# Consolidation & Redundancy Recommendations

## Quick wins (low risk)

1. **Consolidate duplicate auth request logic**
   - `signUp` and `signIn` in `src/services/authService.js` currently duplicate most of their request/parsing/token logic.
   - Create a shared helper like `authRequest(path, formData)` and keep each exported function as a one-liner wrapper.
   - Benefits: less repeated error handling, easier response-shape changes, fewer opportunities for drift.

2. **Remove or merge duplicate user data services**
   - `src/services/dataService.js` is currently an empty placeholder while `src/services/userService.js` contains the actual users API implementation.
   - Keep one canonical users service entry point (`userService` or `dataService`) and remove or re-export the other to avoid ambiguous imports.
   - If naming matters for clarity, keep `userService` and make `dataService` a compatibility re-export only during transition.

3. **Remove dead Maps loader variant**
   - `src/hooks/useMapsLoader.js` and `src/components/MapsLoader/MapsLoader.jsx` implement near-identical loader logic.
   - Only the hook is referenced in `src/App.jsx`; `MapsLoader` component is currently unused.
   - Prefer one approach (hook-only is already adopted) and remove the unused component implementation.

4. **Delete legacy commented blocks in `App.jsx`**
   - `src/App.jsx` contains a large commented legacy app implementation.
   - Move historical code to git history (already preserved) and keep this file focused on active routing.
   - Benefits: faster onboarding and lower cognitive overhead when changing routes.

## Medium-effort refactors

5. **Create a reusable auth form primitive**
   - `src/components/SignInForm/SignInForm.jsx` and `src/components/SignUpForm/SignUpForm.jsx` repeat layout structure, state change handlers, message rendering, submit/cancel button rows, and post-submit navigation.
   - Extract shared pieces into:
     - a generic `<AuthFormLayout />` wrapper,
     - a shared `useAuthForm` hook for `message` + `handleChange`,
     - and small mode-specific field configs.
   - This keeps differences (extra password confirm field + validation) explicit while collapsing repeated boilerplate.

6. **Unify map/picker adapter helpers**
   - `placeToLatLng` in `DirectionsSidebar` and helpers like `toLatLngLiteral` in map utils solve adjacent conversion concerns.
   - Move all place/latlng conversion into one utility module to avoid subtle divergence.

7. **Extract repeated marker event patterns in `useRouting`**
   - Marker listeners (`dragend` rebuild flow, update picker, update state) are repeated across start/end/via markers with slightly different callbacks.
   - Introduce a tiny internal helper for “create draggable marker + standardized drag handling” to reduce duplication and increase readability.

## Architectural consolidation opportunities (longer-term)

8. **Introduce a shared API client layer**
   - Multiple service modules manually run `fetch`, parse JSON, check `data.err`, and throw errors.
   - Add a central `apiClient` utility:
     - injects auth token,
     - parses JSON safely,
     - normalizes backend errors,
     - and returns typed/normalized payloads.
   - Service methods become thin endpoint declarations rather than repeated plumbing.

9. **Centralize route-building orchestration state**
   - `Landing.jsx` coordinates many refs/state hooks and passes a large prop set into `DirectionsSidebar` and `useRouting`.
   - Consider a `useDirectionsController` composition hook that owns orchestration and exposes a compact interface for UI components.
   - Benefit: fewer prop wires, clearer ownership boundaries, easier testing of routing behavior.

## Suggested order of execution

1. Remove/alias the empty `dataService` module and remove unused `MapsLoader` component.
2. Refactor `authService` with shared auth request helper.
3. Remove commented legacy code from `App.jsx`.
4. Extract auth form shared primitives.
5. Introduce API client abstraction and migrate services incrementally.

## Guardrails while refactoring

- Preserve public export names for service modules during transition to avoid broad import churn.
- Add smoke checks after each step (`npm run lint`, `npm run build`).
- For map/routing refactors, keep behavior parity by testing:
  - route build,
  - alternate route selection,
  - drag start/end/via markers,
  - context-menu “Directions to/from here”.

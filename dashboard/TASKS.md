# Dashboard Maintenance Task List

## Refresh button reliability
- [x] Prevent concurrent refresh requests and surface progress to the UI.
- [x] Reset refresh state when the session ends or a refresh completes.
- [x] Extend the regression test suite to cover the manual refresh workflow.
- [ ] Capture and display the timestamp of the last successful refresh in the header.
- [ ] Add analytics/logging to measure refresh failures and latency spikes.

## Alert feed pagination and ordering
- [x] Ensure news digest alerts are ordered before other message types.
- [x] Paginate the alert feed with a default page size of 10 items and navigation controls.
- [x] Add component tests validating ordering and pagination behaviour.
- [ ] Expose the server-side `limit` as a configurable setting in the dashboard client.
- [ ] Explore infinite scrolling as an alternative UX for high-volume alert streams.

## Additional observations
- [ ] Audit the dashboard styles for responsive layouts below 768px; pagination controls may need tweaks.
- [ ] Provide empty-state guidance linking to alert configuration docs when the feed is empty.

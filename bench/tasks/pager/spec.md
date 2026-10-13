# Paginate the users list

`GET /users` returns everything. Add `listUsersPage(users, { q?, page?, pageSize? })` to `users.ts`,
returning `{ items, total, page, pageSize }` (page is 1-based, defaults 1 and 20; `total` = matches
before slicing; it should reuse the existing `q` filter). Wire it into `usersHandler`: when the query
has `page` or `pageSize`, respond with that shape, otherwise behave as today.

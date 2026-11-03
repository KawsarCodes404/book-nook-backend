# BookNook API

Express and MongoDB API for the BookNook online library.

## Run locally

1. Copy `.env.example` to `.env` and set `MONGODB_URI` and `CLIENT_URL`.
2. Install dependencies with `npm install`.
3. Start the API with `node index.js`.

The API listens on port `8000` by default. `CLIENT_URL` must match the BookNook frontend URL because the API validates Better Auth JWTs against that app's JWKS endpoint.

## Routes

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/books` | Public | List books, newest first. Use `?limit=6` for the home page. |
| GET | `/books/:id` | Public | Get one book. |
| POST | `/books` | JWT | Add a book to the signed-in reader's shelf. |
| PATCH | `/books/:id` | JWT | Update a book owned by the signed-in reader. |
| DELETE | `/books/:id` | JWT | Remove a book owned by the signed-in reader. |
| POST | `/borrows` | JWT | Borrow a copy if one is available. |
| GET | `/borrows` | JWT | List active borrows for the signed-in reader. |
| DELETE | `/borrows/:id` | JWT | Return a borrowed book and restore its available copy. |

JWTs are verified with `jose` using the frontend's Better Auth JWKS endpoint. Book and borrow records are stored in the `book-nook` database.

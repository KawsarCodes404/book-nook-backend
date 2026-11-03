import express from 'express'
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config'
import { createRemoteJWKSet, jwtVerify } from 'jose';

const app = express();
const PORT = 8000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}

const mongoClient = await connectToMongoDB();

const db = mongoClient.db("book-nook");
const bookCollection = db.collection("books");
const borrowsCollection = db.collection("borrows");

await borrowsCollection.createIndex(
    { userEmail: 1, bookId: 1 },
    { unique: true, partialFilterExpression: { status: "borrowed" } }
);

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).send({ msg: 'Unauthorized' });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).send({ msg: 'Unauthorized' });
    }

    const clientUrl = process.env.CLIENT_URL || process.env.BETTER_AUTH_URL;
    if (!clientUrl) {
        return res.status(500).json({ message: "CLIENT_URL must point to the BookNook frontend." });
    }

    const JWKS = createRemoteJWKSet(new URL(`${clientUrl}/api/auth/jwks`));

    try {
        const { payload } = await jwtVerify(token, JWKS, {
            issuer: clientUrl,
            audience: clientUrl,
        });
        if (typeof payload.email !== "string" || !payload.email) {
            return res.status(401).json({ message: "The token does not contain a user email." });
        }
        req.user = { email: payload.email, name: typeof payload.name === "string" ? payload.name : "Reader" };
        next();
    } catch {
        return res.status(401).json({ message: "Your session expired. Please log in again." });
    }
};

app.get('/books', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 0, 0), 100);
    let cursor = bookCollection.find().sort({ addedAt: -1 });
    if (limit) cursor = cursor.limit(limit);
    const books = await cursor.toArray();
    res.json(books);
});

app.get('/books/:id', async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid book id." });
    const book = await bookCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!book) return res.status(404).json({ message: "Book not found." });
    res.json(book);
});

app.post('/books', verifyToken, async (req, res) => {
    const { title, author, category, image, description, totalCopies } = req.body;
    if (typeof title !== "string" || !title.trim() || typeof author !== "string" || !author.trim() || typeof image !== "string" || !image.trim() || typeof description !== "string" || !description.trim()) {
        return res.status(400).json({ message: "Title, author, image, and description are required." });
    }
    if (!["Fiction", "Science", "History", "Kids", "Others"].includes(category)) {
        return res.status(400).json({ message: "Choose a valid book category." });
    }
    const copies = Number(totalCopies);
    if (!Number.isInteger(copies) || copies < 1) {
        return res.status(400).json({ message: "Total copies must be at least one." });
    }
    const book = {
        title: title.trim(), author: author.trim(), category,
        image: image.trim(), description: description.trim(),
        totalCopies: copies, availableCopies: copies,
        ownerName: req.user.name, ownerEmail: req.user.email,
        addedAt: new Date(),
    };
    const result = await bookCollection.insertOne(book);
    res.status(201).json({ message: "Book added to the library.", bookId: result.insertedId });
});

app.patch('/books/:id', verifyToken, async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid book id." });
    const allowedFields = ["title", "author", "category", "image", "description", "totalCopies"];
    const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowedFields.includes(key)));
    for (const field of ["title", "author", "image", "description"]) {
        if (update[field] !== undefined) {
            if (typeof update[field] !== "string" || !update[field].trim()) return res.status(400).json({ message: `${field} is required.` });
            update[field] = update[field].trim();
        }
    }
    if (update.totalCopies !== undefined) {
        update.totalCopies = Number(update.totalCopies);
        if (!Number.isInteger(update.totalCopies) || update.totalCopies < 1) return res.status(400).json({ message: "Total copies must be at least one." });
    }
    if (update.category !== undefined && !["Fiction", "Science", "History", "Kids", "Others"].includes(update.category)) {
        return res.status(400).json({ message: "Choose a valid book category." });
    }
    const book = await bookCollection.findOne({ _id: new ObjectId(req.params.id), ownerEmail: req.user.email });
    if (!book) return res.status(404).json({ message: "Book not found in your shelf." });
    if (update.totalCopies !== undefined) {
        const alreadyBorrowed = book.totalCopies - book.availableCopies;
        if (update.totalCopies < alreadyBorrowed) return res.status(400).json({ message: "Total copies cannot be less than copies currently borrowed." });
        update.availableCopies = update.totalCopies - alreadyBorrowed;
    }
    const result = await bookCollection.updateOne(
        { _id: new ObjectId(req.params.id), ownerEmail: req.user.email },
        { $set: update }
    );
    if (!result.matchedCount) return res.status(404).json({ message: "Book not found in your shelf." });
    res.json({ message: "Book details updated." });
});

app.delete('/books/:id', verifyToken, async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid book id." });
    const book = await bookCollection.findOne({ _id: new ObjectId(req.params.id), ownerEmail: req.user.email });
    if (!book) return res.status(404).json({ message: "Book not found in your shelf." });
    const activeBorrow = await borrowsCollection.findOne({ bookId: req.params.id, status: "borrowed" });
    if (activeBorrow) return res.status(409).json({ message: "This book cannot be removed while someone has borrowed it." });
    const result = await bookCollection.deleteOne({ _id: new ObjectId(req.params.id), ownerEmail: req.user.email });
    if (!result.deletedCount) return res.status(404).json({ message: "Book not found in your shelf." });
    res.json({ message: "Book removed from your shelf." });
});

app.post('/borrows', verifyToken, async (req, res) => {
    const { bookId } = req.body;
    if (!ObjectId.isValid(bookId)) return res.status(400).json({ message: "Invalid book id." });
    const book = await bookCollection.findOne({ _id: new ObjectId(bookId) });
    if (!book) return res.status(404).json({ message: "Book not found." });
    const existingBorrow = await borrowsCollection.findOne({ bookId, userEmail: req.user.email, status: "borrowed" });
    if (existingBorrow) return res.status(409).json({ message: "You already borrowed this book." });
    const copyResult = await bookCollection.updateOne(
        { _id: new ObjectId(bookId), availableCopies: { $gt: 0 } },
        { $inc: { availableCopies: -1 } }
    );
    if (!copyResult.modifiedCount) return res.status(409).json({ message: "This book is not available right now." });
    const borrowedAt = new Date();
    const returnAt = new Date(borrowedAt);
    returnAt.setDate(returnAt.getDate() + 7);
    try {
        const result = await borrowsCollection.insertOne({
            bookId, bookTitle: book.title, bookImage: book.image,
            userEmail: req.user.email, userName: req.user.name,
            borrowDate: borrowedAt, returnDate: returnAt, status: "borrowed",
        });
        res.status(201).json({ message: "Book borrowed! Return it within 7 days.", borrowId: result.insertedId });
    } catch (error) {
        await bookCollection.updateOne({ _id: new ObjectId(bookId) }, { $inc: { availableCopies: 1 } });
        if (error?.code === 11000) return res.status(409).json({ message: "You already borrowed this book." });
        throw error;
    }
});

app.get('/borrows', verifyToken, async (req, res) => {
    const borrows = await borrowsCollection.find({ userEmail: req.user.email, status: "borrowed" }).sort({ borrowDate: -1 }).toArray();
    res.json(borrows);
});

app.delete('/borrows/:id', verifyToken, async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid borrow id." });
    const borrow = await borrowsCollection.findOneAndUpdate(
        { _id: new ObjectId(req.params.id), userEmail: req.user.email, status: "borrowed" },
        { $set: { status: "returned", returnedAt: new Date() } },
        { returnDocument: "before" }
    );
    if (!borrow) return res.status(404).json({ message: "Active borrow not found." });
    await bookCollection.updateOne({ _id: new ObjectId(borrow.bookId) }, { $inc: { availableCopies: 1 } });
    res.json({ message: "Book returned. Thank you!" });
});



app.get('/', (req, res) => {
    res.send({ message: `Server is running fine!` });
});

// http://localhost:8000
app.listen(Number(process.env.PORT) || PORT, () => {
    console.log(`Server is running at ${PORT}`);
});

export default app
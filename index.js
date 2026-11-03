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

const categories = ["Fiction", "Science", "History", "Kids", "Others"];

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
        return res.status(500).json({
            message: "CLIENT_URL must point to the BookNook frontend."
        });
    }

    const JWKS = createRemoteJWKSet(
        new URL(`${clientUrl}/api/auth/jwks`)
    );

    try {
        const { payload } = await jwtVerify(token, JWKS, {
            issuer: clientUrl,
            audience: clientUrl,
        });

        if (typeof payload.email !== "string" || !payload.email) {
            return res.status(401).json({
                message: "The token does not contain a user email."
            });
        }

        req.user = {
            email: payload.email,
            name: typeof payload.name === "string" ? payload.name : "Reader",
        };

        next();
    } catch {
        return res.status(401).json({
            message: "Your session expired. Please log in again."
        });
    }
};

// Book routes
app.get('/books', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 0, 0), 100);

    let cursor = bookCollection.find().sort({ addedAt: -1 });

    if (limit) {
        cursor = cursor.limit(limit);
    }

    const result = await cursor.toArray();

    res.json(result);
});

app.get('/books/:id', async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid book id." });
    }

    const result = await bookCollection.findOne({
        _id: new ObjectId(id)
    });

    if (!result) {
        return res.status(404).json({ message: "Book not found." });
    }

    res.json(result);
});

app.post('/books', verifyToken, async (req, res) => {
    const { title, author, category, image, description, totalCopies } = req.body;

    if (
        typeof title !== "string" || !title.trim() ||
        typeof author !== "string" || !author.trim() ||
        typeof image !== "string" || !image.trim() ||
        typeof description !== "string" || !description.trim()
    ) {
        return res.status(400).json({
            message: "Title, author, image, and description are required."
        });
    }

    if (!categories.includes(category)) {
        return res.status(400).json({
            message: "Choose a valid book category."
        });
    }

    const copies = Number(totalCopies);

    if (!Number.isInteger(copies) || copies < 1) {
        return res.status(400).json({
            message: "Total copies must be at least one."
        });
    }

    const book = {
        title: title.trim(),
        author: author.trim(),
        category,
        image: image.trim(),
        description: description.trim(),
        totalCopies: copies,
        availableCopies: copies,
        ownerName: req.user.name,
        ownerEmail: req.user.email,
        addedAt: new Date(),
    };

    const result = await bookCollection.insertOne(book);

    res.status(201).json({
        message: "Book added to the library.",
        bookId: result.insertedId,
    });
});

app.patch('/books/:id', verifyToken, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid book id." });
    }

    const bookId = new ObjectId(id);

    const book = await bookCollection.findOne({
        _id: bookId,
        ownerEmail: req.user.email,
    });

    if (!book) {
        return res.status(404).json({
            message: "Book not found in your shelf."
        });
    }

    const { title, author, category, image, description, totalCopies } = req.body;
    const updatedData = {};

    if (title !== undefined) {
        if (typeof title !== "string" || !title.trim()) {
            return res.status(400).json({ message: "Title is required." });
        }

        updatedData.title = title.trim();
    }

    if (author !== undefined) {
        if (typeof author !== "string" || !author.trim()) {
            return res.status(400).json({ message: "Author is required." });
        }

        updatedData.author = author.trim();
    }

    if (category !== undefined) {
        if (!categories.includes(category)) {
            return res.status(400).json({
                message: "Choose a valid book category."
            });
        }

        updatedData.category = category;
    }

    if (image !== undefined) {
        if (typeof image !== "string" || !image.trim()) {
            return res.status(400).json({ message: "Image is required." });
        }

        updatedData.image = image.trim();
    }

    if (description !== undefined) {
        if (typeof description !== "string" || !description.trim()) {
            return res.status(400).json({
                message: "Description is required."
            });
        }

        updatedData.description = description.trim();
    }

    if (totalCopies !== undefined) {
        const copies = Number(totalCopies);

        if (!Number.isInteger(copies) || copies < 1) {
            return res.status(400).json({
                message: "Total copies must be at least one."
            });
        }

        const borrowedCopies = book.totalCopies - book.availableCopies;

        if (copies < borrowedCopies) {
            return res.status(400).json({
                message: "Total copies cannot be less than copies currently borrowed."
            });
        }

        updatedData.totalCopies = copies;
        updatedData.availableCopies = copies - borrowedCopies;
    }

    const result = await bookCollection.updateOne(
        {
            _id: bookId,
            ownerEmail: req.user.email,
        },
        {
            $set: updatedData,
        }
    );

    if (!result.matchedCount) {
        return res.status(404).json({
            message: "Book not found in your shelf."
        });
    }

    res.json({ message: "Book details updated." });
});

app.delete('/books/:id', verifyToken, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid book id." });
    }

    const bookId = new ObjectId(id);

    const book = await bookCollection.findOne({
        _id: bookId,
        ownerEmail: req.user.email,
    });

    if (!book) {
        return res.status(404).json({
            message: "Book not found in your shelf."
        });
    }

    const activeBorrow = await borrowsCollection.findOne({
        bookId: id,
        status: "borrowed",
    });

    if (activeBorrow) {
        return res.status(409).json({
            message: "This book cannot be removed while someone has borrowed it."
        });
    }

    const result = await bookCollection.deleteOne({
        _id: bookId,
        ownerEmail: req.user.email,
    });

    if (!result.deletedCount) {
        return res.status(404).json({
            message: "Book not found in your shelf."
        });
    }

    res.json({ message: "Book removed from your shelf." });
});

// Borrow routes
app.post('/borrows', verifyToken, async (req, res) => {
    const { bookId } = req.body;

    if (!ObjectId.isValid(bookId)) {
        return res.status(400).json({ message: "Invalid book id." });
    }

    const book = await bookCollection.findOne({
        _id: new ObjectId(bookId)
    });

    if (!book) {
        return res.status(404).json({ message: "Book not found." });
    }

    const existingBorrow = await borrowsCollection.findOne({
        bookId,
        userEmail: req.user.email,
        status: "borrowed",
    });

    if (existingBorrow) {
        return res.status(409).json({
            message: "You already borrowed this book."
        });
    }

    const copyResult = await bookCollection.updateOne(
        {
            _id: new ObjectId(bookId),
            availableCopies: { $gt: 0 },
        },
        {
            $inc: { availableCopies: -1 },
        }
    );

    if (!copyResult.modifiedCount) {
        return res.status(409).json({
            message: "This book is not available right now."
        });
    }

    const borrowedAt = new Date();
    const returnAt = new Date(borrowedAt);

    returnAt.setDate(returnAt.getDate() + 7);

    try {
        const result = await borrowsCollection.insertOne({
            bookId,
            bookTitle: book.title,
            bookImage: book.image,
            userEmail: req.user.email,
            userName: req.user.name,
            borrowDate: borrowedAt,
            returnDate: returnAt,
            status: "borrowed",
        });

        res.status(201).json({
            message: "Book borrowed! Return it within 7 days.",
            borrowId: result.insertedId,
        });
    } catch (error) {
        await bookCollection.updateOne(
            { _id: new ObjectId(bookId) },
            { $inc: { availableCopies: 1 } }
        );

        if (error?.code === 11000) {
            return res.status(409).json({
                message: "You already borrowed this book."
            });
        }

        throw error;
    }
});

app.get('/borrows', verifyToken, async (req, res) => {
    const result = await borrowsCollection.find({
        userEmail: req.user.email,
        status: "borrowed",
    }).sort({ borrowDate: -1 }).toArray();

    res.json(result);
});

app.delete('/borrows/:id', verifyToken, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid borrow id." });
    }

    const result = await borrowsCollection.findOneAndUpdate(
        {
            _id: new ObjectId(id),
            userEmail: req.user.email,
            status: "borrowed",
        },
        {
            $set: {
                status: "returned",
                returnedAt: new Date(),
            },
        },
        {
            returnDocument: "before",
        }
    );

    if (!result) {
        return res.status(404).json({
            message: "Active borrow not found."
        });
    }

    await bookCollection.updateOne(
        { _id: new ObjectId(result.bookId) },
        { $inc: { availableCopies: 1 } }
    );

    res.json({ message: "Book returned. Thank you!" });
});

app.get('/', (req, res) => {
    res.send({ message: `Server is running fine!` });
});

// http://localhost:8000
const port = Number(process.env.PORT) || PORT;

app.listen(port, () => {
    console.log(`Server is running at ${port}`);
});

export default app

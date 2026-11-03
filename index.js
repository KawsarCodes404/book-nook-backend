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

app.get('/', (req, res) => {
    res.send({ message: `Server is running fine!` });
});

// http://localhost:8000
app.listen(PORT, () => {
    console.log(`Server is running at ${PORT}`);
});

export default app
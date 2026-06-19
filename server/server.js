require("dotenv").config({ path: "./.env" });
const app = require("./app");

const PORT = process.env.PORT || 8000;

const startServer = () => {
    // Optionally: Connect to database here before starting server
    // connectDB().then(() => { ... })
    
    app.listen(PORT, () => {
        console.log(`⚙️  Server is running on port: ${PORT}`);
    });
};

startServer();

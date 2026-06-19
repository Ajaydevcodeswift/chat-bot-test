const express = require("express");
const morgan = require("morgan");
const helmet = require("helmet");
const { errorHandler } = require("./middlewares/error.middleware");
const { ApiError } = require("./utils/ApiError");
const { ApiResponse } = require("./utils/ApiResponse");


const app = express();

// Middlewares
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logger for development
if (process.env.NODE_ENV === "development") {
    app.use(morgan("dev"));
}

// Routes

app.get("/health", (req, res) => {
    res.status(200).json(new ApiResponse(200, { status: "OK" }, "Server is healthy"));
});



// Global Error Handler
app.use((req, res, next) => {
    next(new ApiError(404, `Can't find ${req.originalUrl} on this server!`));
});


app.use(errorHandler);

module.exports = app;

const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const path = require('path')

const app = express()
app.use(express.json())

// Initialize DB and server
let db = null
const databasePath = path.join(__dirname, 'expenseDatabase.db')

const initializeDbAndServer = async () => {
    try {
      db = await open({
        filename: databasePath,
        driver: sqlite3.Database,
      })
  
      // Create 'user' table if it doesn't exist
      const createUserTableQuery = `
        CREATE TABLE IF NOT EXISTS user (
          user_id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          password TEXT NOT NULL,
          gender TEXT
        );
      `
      await db.run(createUserTableQuery)
  
      // Create 'transactions' table if it doesn't exist
      const createTransactionsTableQuery = `
        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
          category TEXT NOT NULL,
          amount REAL NOT NULL,
          date TEXT NOT NULL,
          description TEXT,
          user_id INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES user (user_id)
        );
      `
      await db.run(createTransactionsTableQuery)
  
      // Create 'categories' table if it doesn't exist
      const createCategoriesTableQuery = `
        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('income', 'expense'))
        );
      `
      await db.run(createCategoriesTableQuery)
  
      app.listen(3000, () => {
        console.log('Server Running at http://localhost:3000/')
      })
    } catch (error) {
      console.error(`Database Error: "${error.message}"`)
      process.exit(1)
    }
  }
  
initializeDbAndServer()

// User Authentication Routes

// Register
app.post('/register/', async (req, res) => {
  const {username, password, name, gender} = req.body
  const hashedPassword = await bcrypt.hash(password, 10)
  const checkUserNameQuery = `SELECT * FROM user WHERE username="${username}";`
  const userData = await db.get(checkUserNameQuery)

  if (userData) {
    res.status(400).send('User already exists')
  } else if (password.length < 6) {
    res.status(400).send('Password is too short')
  } else {
    const insertUserQuery = `INSERT INTO user(username, name, password, gender)
                             VALUES("${username}", "${name}", "${hashedPassword}", "${gender}");`
    await db.run(insertUserQuery)
    res.status(200).send('User created successfully')
  }
})

// Login
app.post('/login/', async (req, res) => {
  const {username, password} = req.body
  const selectUserQuery = `SELECT * FROM user WHERE username="${username}";`
  const dbUser = await db.get(selectUserQuery)

  if (!dbUser) {
    res.status(400).send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched) {
      const payload = {username: dbUser.username, user_id: dbUser.user_id}
      const jwtToken = jwt.sign(payload, 'SECRET_CODE')
      res.send({jwtToken})
    } else {
      res.status(400).send('Invalid password')
    }
  }
})

// Middleware to authenticate JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  if (!authHeader) {
    return res.status(401).send('Invalid JWT Token')
  }

  const jwtToken = authHeader.split(' ')[1]
  jwt.verify(jwtToken, 'SECRET_CODE', (error, payload) => {
    if (error) {
      res.status(401).send('Invalid JWT Token')
    } else {
      req.user = payload
      next()
    }
  })
}


// Transactions Routes

// Add a new transaction
app.post('/transactions/', authenticateToken, async (req, res) => {
    const {type, category, amount, date, description} = req.body
    const addTransactionQuery = `
      INSERT INTO transactions (type, category, amount, date, description, user_id)
      VALUES ("${type}", "${category}", ${amount}, "${date}", "${description}", ${req.user.user_id});
    `
    await db.run(addTransactionQuery)
    res.status(200).send('Transaction added successfully')
  })
  
  // Get all transactions for the logged-in user
  app.get('/transactions/', authenticateToken, async (req, res) => {
    const getTransactionsQuery = `
      SELECT * FROM transactions WHERE user_id = ${req.user.user_id};
    `
    const transactions = await db.all(getTransactionsQuery)
    res.send(transactions)
  })
  
  // Get transaction by ID
  app.get('/transactions/:id', authenticateToken, async (req, res) => {
    const {id} = req.params
    const getTransactionQuery = `
      SELECT * FROM transactions WHERE id = ${id} AND user_id = ${req.user.user_id};
    `
    const transaction = await db.get(getTransactionQuery)
  
    if (transaction) {
      res.send(transaction)
    } else {
      res.status(404).send('Transaction not found')
    }
  })
  
  // Update transaction by ID
  app.put('/transactions/:id', authenticateToken, async (req, res) => {
    const {id} = req.params
    const {type, category, amount, date, description} = req.body
    const updateTransactionQuery = `
      UPDATE transactions
      SET type = "${type}", category = "${category}", amount = ${amount}, date = "${date}", description = "${description}"
      WHERE id = ${id} AND user_id = ${req.user.user_id};
    `
    const result = await db.run(updateTransactionQuery)
  
    if (result.changes === 0) {
      res.status(404).send('Transaction not found or not authorized to update')
    } else {
      res.send('Transaction updated successfully')
    }
  })
  
  // Delete transaction by ID
  app.delete('/transactions/:id', authenticateToken, async (req, res) => {
    const {id} = req.params
    const deleteTransactionQuery = `
      DELETE FROM transactions WHERE id = ${id} AND user_id = ${req.user.user_id};
    `
    const result = await db.run(deleteTransactionQuery)
  
    if (result.changes === 0) {
      res.status(404).send('Transaction not found or not authorized to delete')
    } else {
      res.send('Transaction deleted successfully')
    }
  })
  
  // Get summary of transactions
  app.get('/summary', authenticateToken, async (req, res) => {
    const totalIncomeQuery = `
      SELECT SUM(amount) AS totalIncome FROM transactions WHERE type = 'income' AND user_id = ${req.user.user_id};
    `
    const totalExpenseQuery = `
      SELECT SUM(amount) AS totalExpense FROM transactions WHERE type = 'expense' AND user_id = ${req.user.user_id};
    `
  
    const totalIncome = await db.get(totalIncomeQuery)
    const totalExpense = await db.get(totalExpenseQuery)
  
    const balance = (totalIncome.totalIncome || 0) - (totalExpense.totalExpense || 0)
  
    res.send({
      totalIncome: totalIncome.totalIncome || 0,
      totalExpense: totalExpense.totalExpense || 0,
      balance,
    })
  })
  

module.exports = app
const router = require('express').Router();
const { isDoctor } = require('../utils');
const PORT = process.env.PORT || 8000;
// const { Server } = require('socket.io');

// Ran into a lot of issues here, if this doesn't work, you know why
// Sunk cost fallacy or something

module.exports = (db, server) => {
	// const io = new Server(server);

	// io.on('connection', (socket) => {
	// 	socket.on('message', ({content, from, to}) => {
	// 		socket.to(to).emit('message', {
	// 			content,
	// 			from,
	// 			to
	// 		})
	// 	})
	// });

	router.get('/', async (req, res) => {
		// Check if user is a user or a doctor and fetch appropriately
		let users = await db.run('SELECT userID, username FROM logininfo WHERE userID != ?', req.session.login);
	
		users = users.filter(user => isDoctor(req.session.login)
								  ? !isDoctor(user.userID)
								  :  isDoctor(user.userID));
	
		res.render('chat-users', { auth: req.session.login, users });
	});
	
	router.get('/user/:userID', async (req, res) => {
		const userID = req.params.userID;
		const messages = await db.run('SELECT (SELECT username FROM logininfo WHERE userID = fromUser) as sender, datetimeSent, content FROM messages WHERE (toUser = ? OR toUser = ?) AND (fromUser = ? OR fromUser = ?) ORDER BY sentAt ASC', req.session.login, userID, req.session.login, userID);

		res.render('chat', { auth: req.session.login, userID, isDoctor: isDoctor(req.session.login), messages });
	});

	return router;
}
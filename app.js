const express = require('express');
const mysql = require('mysql2');
const { setIntervalAsync } = require('set-interval-async');


const pool = mysql.createPool({
    connectionLimit: 10,
    host: 'localhost',
    user: 'root',
    password: 'qwerty',
    database: 'haaletus',
    port: 3306,
});


const app = express();
const VOTE_TIME_LIMIT = 300000
const START_DATETIME = new Date();


let isVotingEnabled = true;
let timeLeft = VOTE_TIME_LIMIT;


setIntervalAsync(async () => {
    timeLeft -= 1000;
    if (timeLeft <= 0 && isVotingEnabled) {
        isVotingEnabled = false;
        timeLeft = 0;

        try {
            const poolt_haalte_arv = (await pool.promise().query('SELECT COUNT(*) as count FROM HAALETUS WHERE otsus = ?', ['poolt']))[0][0].count;
            const vastu_haalte_arv = (await pool.promise().query('SELECT COUNT(*) as count FROM HAALETUS WHERE otsus = ?', ['vastu']))[0][0].count;
            const haaltenumber = (await pool.promise().query('SELECT COUNT(*) as count FROM TULEMUSED'))[0][0].count + 1;
            const tulemus = {
                haaltenumber: haaltenumber,
                h_alguse_aeg: START_DATETIME,
                poolt_haalte_arv: poolt_haalte_arv,
                vastu_haalte_arv: vastu_haalte_arv
            };
            await pool.promise().query('INSERT INTO TULEMUSED (haaltenumber, h_alguse_aeg, poolt_haalte_arv, vastu_haalte_arv) VALUES (?, ?, ?, ?)', [tulemus.haaltenumber, tulemus.h_alguse_aeg, tulemus.poolt_haalte_arv, tulemus.vastu_haalte_arv]);
        } catch (error) {
            console.error(error);
        }
    }

    if (timeLeft <= 0) {
        timeLeft = 0;
    }
}, 1000);


app.use(express.static('public'));
app.use(express.json());


app.post('/vote', async (req, res) => {
    const { firstName, lastName, decision } = req.body;

    try {
        const totalResults = await pool.promise().query('SELECT COUNT(*) as count FROM HAALETUS');
        const totalVotes = totalResults[0][0].count;

        if (totalVotes >= 11 && !(await hasVoted(firstName, lastName))) {
            res.status(403).send('Voting is no longer enabled');
            return;
        }

        if (totalVotes >= 11 && await hasVoted(firstName, lastName)) {
            const voter = await getVoter(firstName, lastName);

            if (!voter.muutmise_aeg && timeLeft <= 0) {
                res.status(403).send('Time limit has been reached, no more votes can be updated');
                return;
            }

            await pool.promise().query('UPDATE HAALETUS SET otsus = ? WHERE id = ?', [decision, voter.id]);
            await pool.promise().query('INSERT INTO LOGI (haaletaja_id, muudetud_veerg, vana_vaartus, uus_vaartus, muutmise_aeg) VALUES (?, ?, ?, ?, ?)', [voter.id, 'otsus', voter.otsus, decision, new Date()]);
            res.status(200).send('OK');
            return;
        }

        const voter = await getVoter(firstName, lastName);
        if (!voter) {
            await pool.promise().query('INSERT INTO HAALETUS (eesnimi, perenimi, otsus) VALUES (?, ?, ?)', [firstName, lastName, decision]);
            const insertResult = await pool.promise().query('SELECT LAST_INSERT_ID() as id');
            const voterId = insertResult[0][0].id;
            await pool.promise().query('INSERT INTO LOGI (haaletaja_id, muudetud_veerg, vana_vaartus, uus_vaartus, muutmise_aeg) VALUES (?, ?, IFNULL(?, \'\'), ?, ?)', [voterId, 'otsus', null, decision, new Date()]);
            res.status(200).send('OK');
            return;
        }

        await pool.promise().query('UPDATE HAALETUS SET otsus = ? WHERE id = ?', [decision, voter.id]);
        await pool.promise().query('INSERT INTO LOGI (haaletaja_id, muudetud_veerg, vana_vaartus, uus_vaartus, muutmise_aeg) VALUES (?, ?, ?, ?, ?)', [voter.id, 'otsus', voter.otsus, decision, new Date()]);
        res.status(200).send('OK');
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});


async function hasVoted(firstName, lastName) {
    const results = await pool.promise().query('SELECT * FROM HAALETUS WHERE eesnimi = ? AND perenimi = ?', [firstName, lastName]);
    return results[0].length > 0;
}


async function getVoter(firstName, lastName) {
    const results = await pool.promise().query('SELECT * FROM HAALETUS WHERE eesnimi = ? AND perenimi = ?', [firstName, lastName]);
    return results[0][0];
}


app.get('/results', (req, res) => {
    pool.query('SELECT COUNT(*) AS total FROM HAALETUS', (error, results) => {
        if (error) {
            console.error(error);
            res.status(500).send('Internal Server Error');
        } else {
            const total = results[0].total;

            pool.query('SELECT COUNT(*) AS forCount FROM HAALETUS WHERE otsus = ?', ['poolt'], (error, results) => {
                if (error) {
                    console.error(error);
                    res.status(500).send('Internal Server Error');
                } else {
                    const forCount = results[0].forCount;

                    pool.query('SELECT COUNT(*) AS againstCount FROM HAALETUS WHERE otsus = ?', ['vastu'], (error, results) => {
                        if (error) {
                            console.error(error);
                            res.status(500).send('Internal Server Error');
                        } else {
                            const againstCount = results[0].againstCount;

                            res.status(200).json({ total, forCount, againstCount, timeLeft });
                        }
                    });
                }
            });
        }
    });
});


app.listen(3000, () => {
    console.log('Server started on port http://localhost:3000');
}); 
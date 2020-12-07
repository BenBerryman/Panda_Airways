const pool = require('./db');

//TYPE can be either 'all' or 'one'
//IF 'all', args={to:<>, from:<>, date:<>}
//IF 'one', args={flightID:<>}

const transactionStatus = async(status) => {
    switch (status){
        case "start":
        {
            await pool.query(`BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;`);
            break;
        } 
        case "commit":
        {
            await pool.query(`COMMIT;`);
            break;
        }
        case "rollback":
        {
            await pool.query(`ROLLBACK;`);
            break;
        }
    }
}

const directFlights = async(type, args) => {
    try
    {
        var response;
        var base = `SELECT departing.id, scheduled_departure, scheduled_arrival, departing.city AS depart_city,
            departing.flight_status AS depart_flight_status, departing.airport_code AS depart,
            arriving.city AS arrive_city, arriving.airport_code AS arrive
        FROM
            (SELECT id,scheduled_departure, scheduled_arrival, city, airport_code, flight_status
            FROM flight JOIN airport
            ON flight.departure_airport=airport.airport_code) departing
        JOIN
            (SELECT id, city, airport_code
            FROM flight JOIN airport
            ON flight.arrival_airport=airport.airport_code) arriving
        ON departing.id=arriving.id`;

        switch(type)
        {
            case "all":
                response = await pool.query(
                    `${base}
            WHERE departing.airport_code LIKE $1 AND arriving.airport_code LIKE $2
            AND scheduled_departure::text LIKE $3
            ORDER BY scheduled_departure ASC;`,
                    [args.from, args.to, args.date+' %']);
                return response.rows;
            case "one":
                response = await pool.query(
                    `${base}
            WHERE departing.id=$1;`, [args.flightID]);
                return response.rows[0];
        }
    } catch(err) {
        console.log(err.message);
    }
}

//TYPE can be either 'all' or 'one'
//IF 'all', args={to:<>, from:<>, date:<>}
//IF 'one', args={flightID:<>, flightID2:<>}
const connectionFlights = async(type, args)  => {
    try
    {
        var response;
        var base =
            `SELECT departing.id,
                departing.scheduled_departure AS scheduled_departure,
                departing.scheduled_arrival AS initial_scheduled_arrival,
                departing.city AS depart_city,
                departing.flight_status AS depart_flight_status,
                departing.airport_code AS depart,
                connection1Departing.scheduled_departure AS conn1_scheduled_departure,
                connection1Departing.scheduled_arrival AS scheduled_arrival, 
                connection1.city AS conn1_city,
                connection1.airport_code AS conn1,
                connection1Departing.flight_status AS conn1_flight_status,
                connection1Departing.id AS conn1_id,
                arriving.city AS arrive_city,
                arriving.airport_code AS arrive
            FROM
                (SELECT id,scheduled_departure, scheduled_arrival, city, airport_code, flight_status
                 FROM flight JOIN airport
                                   ON flight.departure_airport=airport.airport_code) departing
                    JOIN
                (SELECT id, city, airport_code
                 FROM flight JOIN airport
                                   ON flight.arrival_airport=airport.airport_code) connection1
                ON departing.id=connection1.id
                    JOIN
                ((SELECT id, scheduled_departure, scheduled_arrival, city, airport_code, flight_status
                 FROM flight JOIN airport
                                   ON flight.departure_airport=airport.airport_code) connection1Departing
                    JOIN
                (SELECT id, city, airport_code
                 FROM flight JOIN airport
                                   ON flight.arrival_airport=airport.airport_code) arriving
                ON connection1Departing.id=arriving.id)
                ON connection1.airport_code=connection1Departing.airport_code`;

        switch(type)
        {
            case "all":
                response = await pool.query(
                    `${base}
            WHERE connection1Departing.scheduled_departure > departing.scheduled_arrival
            AND departing.airport_code LIKE $1 AND arriving.airport_code LIKE $2
            AND departing.scheduled_departure::text LIKE $3
            AND connection1Departing.scheduled_departure::text LIKE $3
            ORDER BY departing.scheduled_departure ASC;`,
                    [args.from, args.to, args.date+' %']);
                return response.rows;
            case "one":
                response = await pool.query(
                    `${base}
            WHERE departing.id=$1
            AND connection1Departing.id=$2;`,
                    [args.flightID, args.flightID2]);
                return response.rows[0];
        }
    } catch(err) {
        console.log(err.message);
    }
}

const cities = async(type, code=null) => {
    try
    {
        var response;
        switch(type)
        {
            case 'all':
                response = await pool.query('SELECT DISTINCT city, airport_code FROM airport');
                return response.rows;
            case 'one':
                response = await pool.query('SELECT city FROM airport WHERE airport_code LIKE $1', [code]);
                return response.rows[0].city;
        }
    } catch(err) {
        console.log(err.message);
    }
}

const getBooking = async(bookRef, type) => {
    try {
        var passengers;
        var cardLastFour;
        switch(type)
        {
            case 'passengerCount':
                passengers = await pool.query(
                    `SELECT COUNT(DISTINCT passenger.id)
                    FROM booking
                    JOIN ticket
                        ON booking.book_ref=ticket.book_ref
                    JOIN passenger
                        ON passenger.id=ticket.passenger_id
                    WHERE booking.book_ref LIKE $1;`,
                                [bookRef]);
                passengers = passengers.rows[0].count;
                break;
            case 'all':
                passengers = await pool.query(
                    `SELECT DISTINCT passenger.id, first_name, last_name, date_of_birth
                    FROM booking
                    JOIN ticket
                        ON booking.book_ref=ticket.book_ref
                    JOIN passenger
                        ON passenger.id=ticket.passenger_id
                    WHERE booking.book_ref LIKE $1;`,
                                [bookRef]);
                passengers = passengers.rows;
            case 'cardNumber':
                var cardNumber = await pool.query(
                    `SELECT credit_card.card_number
                    FROM booking
                    JOIN credit_card
                        ON booking.card_number = credit_card.card_number
                    WHERE booking.book_ref LIKE $1;`,
                    [bookRef]);
                cardLastFour = cardNumber.rows[0].card_number.toString().substr(12);
        }
        var flight = await pool.query(
            `WITH RECURSIVE tab AS (
                (SELECT amount, t.book_ref, id, flight_id, fare_condition, connecting_ticket
                 FROM ticket t
                          JOIN booking ON t.book_ref=booking.book_ref
                 WHERE t.book_ref=$1
                 ORDER BY connecting_ticket ASC
                 LIMIT 1)
                UNION ALL

                SELECT amount, t.book_ref, t.id, t.flight_id, t.fare_condition, t.connecting_ticket
                FROM ticket t
                         JOIN
                     tab
                     ON tab.connecting_ticket=t.id)
             SELECT amount, id, flight_id, fare_condition, connecting_ticket FROM tab;`,
            [bookRef]);
        response = {
            flight: flight.rows[0].flight_id,
            fare: flight.rows[0].fare_condition,
            travelers: passengers,
            amount: flight.rows[0].amount,
            cardLastFour: cardLastFour
        };
        if(flight.rows[1] !== undefined)
            response.flight2 = flight.rows[1].flight_id;
        return response;

    } catch(err) {
        console.log(err.message);
    }
}

const checkAvailability = async(fare, flightID, travelers) => {
    var response;
    switch(fare)
    {
        case "economy":
            response = await pool.query(
                `SELECT
                CASE WHEN economy_available<$1
                    THEN FALSE
                ELSE TRUE
                END
            FROM flight WHERE id=$2;`,
                [travelers, flightID]);
            break;
        case "economy_plus":
            response = await pool.query(
                `SELECT
                CASE WHEN economy_plus_available<$1
                    THEN FALSE
                ELSE TRUE
                END
            FROM flight WHERE id=$2;`,
                [travelers, flightID]);
            break;
        case "business":
            response = await pool.query(
                `SELECT
                CASE WHEN business_available<$1
                    THEN FALSE
                ELSE TRUE
                END
            FROM flight WHERE id=$2;`,
                [travelers, flightID]);
            break;
    }
    return response.rows[0].case;
}

const postCreditCard = async(cardNum, nameOnCard, expMonth, expYear) => {
    await pool.query(
        `INSERT INTO credit_card VALUES ($1, $2, $3, $4) ON CONFLICT(card_number) DO NOTHING`,
        [cardNum, nameOnCard, expMonth, expYear]);
}

const postBooking = async(bookRef, cardNum, discount, amount, contactEmail, contactPhone) => {
    const response = await pool.query(
        `INSERT INTO booking (book_ref, card_number, discount_code, amount, contact_email, contact_phone_number, booking_date)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP);`,
        [bookRef, cardNum, discount, amount, contactEmail, contactPhone]);
}

const postPassenger = async(firstName, lastName, date_of_birth) => {
    const response = await pool.query(
        `INSERT INTO passenger (first_name, last_name, date_of_birth)
            VALUES ($1, $2, $3) RETURNING id;`,
        [firstName, lastName, date_of_birth]);
    return response.rows[0].id;
}

const postTicket = async(bookRef, flightID, passID, fare, connectingTicket=null) => {
    try {
        var ticket = await pool.query(
            `INSERT INTO ticket (book_ref, flight_id, passenger_id, fare_condition, connecting_ticket)
            VALUES ($1, $2, $3, $4, $5) RETURNING id;`,
            [bookRef, flightID, passID, fare, connectingTicket]);
        await postSeat(fare, flightID, 1);
        return ticket.rows[0].id;
    } catch(err) {
        console.log(err.message);
    }

}

const postSeat = async(fare, flightID, travelers) => {
    switch (fare){
        case "Economy":
            await pool.query(
                `UPDATE flight
                    SET economy_booked=economy_booked+$1,
                        economy_available=economy_available-$1
                    WHERE id=$2;`,
                    [travelers, flightID]);
            break;
        case "Economy Plus":
            await pool.query(
                `UPDATE flight
                    SET economy_plus_booked=economy_plus_booked+$1,
                        economy_plus_available=economy_plus_available-$1
                    WHERE id=$2;`,
                    [travelers, flightID]);
            break;
        case "Business":
            await pool.query(
                `UPDATE flight
                    SET business_booked=business_booked+$1,
                        business_available=business_available-$1
                    WHERE id=$2;`,
                    [travelers, flightID]);
            break;
    }
}

const removeSeat = async(fare, flightID, travelers) => {
    switch (fare){
        case "Economy":
            await pool.query(
                `UPDATE flight
                    SET economy_booked=economy_booked-$1,
                        economy_available=economy_available+$1
                    WHERE id=$2;`,
                [travelers, flightID]);
            break;
        case "Economy Plus":
            await pool.query(
                `UPDATE flight
                    SET economy_plus_booked=economy_plus_booked-$1,
                        economy_plus_available=economy_plus_available+$1
                    WHERE id=$2;`,
                [travelers, flightID]);
            break;
        case "Business":
            await pool.query(
                `UPDATE flight
                    SET business_booked=business_booked-$1,
                        business_available=business_available+$1
                    WHERE id=$2;`,
                [travelers, flightID]);
            break;
    }
}

const putBookingAmount = async(bookRef, newAmount) => {
    try {
        await pool.query(
            `UPDATE booking
                SET amount=$1
            WHERE book_ref LIKE $2;`,
            [newAmount, bookRef]);
    } catch(err) {
        console.log(err.message);
    }
}

const getAllTickets = async(bookRef, passengerID) => {
    try {
        const tickets = await pool.query(
            `WITH RECURSIVE tab AS (
                (SELECT amount, t.book_ref, id, flight_id, fare_condition, connecting_ticket
                 FROM ticket t
                          JOIN booking ON t.book_ref=booking.book_ref
                 WHERE t.book_ref=$1 AND t.passenger_id=$2
                 ORDER BY connecting_ticket ASC
                 LIMIT 1)
                UNION ALL

                SELECT amount, t.book_ref, t.id, t.flight_id, t.fare_condition, t.connecting_ticket
                FROM ticket t
                         JOIN
                     tab
                     ON tab.connecting_ticket=t.id)
             SELECT amount, id, flight_id, fare_condition, connecting_ticket FROM tab;`,
            [bookRef, passengerID]);
        return tickets.rows;
    } catch(err) {
        console.log(err.message);
    }
}
const updateTicket = async(ticketID, flightID, fare) => {
    try {
        var oldFlight = await pool.query(
            `SELECT flight_id, fare_condition
            FROM ticket
            WHERE id=$1;`,
            [ticketID]);
        var newTicketID = await pool.query(
            `UPDATE ticket
            SET flight_id=$1,
                fare_condition=$2
            WHERE id=$3 RETURNING id;`,
            [flightID, fare, ticketID]);

        await removeSeat(oldFlight.rows[0].fare_condition, oldFlight.rows[0].flight_id, 1);
        await postSeat(fare, flightID, 1);
        return newTicketID.rows[0].id;
    } catch(err) {
        console.log(err.message);
    }
}

const deleteTicket = async(ticketID) => {
    try {
        var flightAndFare = await pool.query(
            `DELETE FROM ticket
            WHERE id=$1 RETURNING flight_id, fare_condition;`,
            [ticketID]);
        await removeSeat(flightAndFare.rows[0].fare_condition, flightAndFare.rows[0].flight_id, 1);
    } catch(err) {
        console.log(err.message);
    }
}

module.exports = {transactionStatus, directFlights, connectionFlights, cities, getBooking, checkAvailability,
    postCreditCard, postBooking, postPassenger, postTicket, postSeat, removeSeat, putBookingAmount, updateTicket,
    deleteTicket, getAllTickets};

// try {
//
// } catch(err) {
//     console.log(err.message);
// }
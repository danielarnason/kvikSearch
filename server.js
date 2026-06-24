import express from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import swaggerJSDoc from 'swagger-jsdoc'
import pkg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pkg

const app = express()
app.use(cors())

const port = 8000

const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Mit lokale Frankenstein GSearch API',
            version: '1.0.0',
            description: 'En lokal frankenstein erstatning for KDS GSearch'
        },
        paths: {
            '/husnummer': {
                get: {
                    summary: 'Søg efter husnumre (Fuzzy & Type-ahead)',
                    parameters: [
                        {
                            in: 'query',
                            name: 'q',
                            required: true,
                            schema: {
                                type: 'string'
                            },
                            description: 'Søgestrengen (f.eks. vejnavn)'
                        }
                    ],
                    responses: {
                        '200': {
                            description: 'En liste med op til 10 matchende adresser'
                        }
                    }
                }
            }
        }
    },
    apis: [] // Tom, da vi ikke bruger kommentarer mere
}

const swaggerSpec = swaggerJSDoc(swaggerOptions)
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

const pool = new Pool({
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT
})

app.get('/husnummer', async (req, res) => {
    const q = req.query.q

    if (!q) {
        return res.status(400).json({
            error: 'Parameter \'q\' mangler. Prøv f.eks. ?q=Dahlsvej'
        })
    }

    const queryString = q.trim()
    const prefix = queryString.length >= 3 ? queryString.substring(0, 3) + '%' : queryString + '%'
    const regexWordBoundary = `\\y${queryString.substring(0, 3)}`

    const sql = `
        SELECT
            id, 
            type,
            sogestreng,
            ST_AsGeoJSON(geom)::json as geometry,
            gsearch.word_similarity($1::text, sogestreng::text) AS score
        FROM
            gsearch.soge_indeks
        WHERE
            $2::text OPERATOR(gsearch.<%) sogestreng::text
            AND (
                sogestreng ILIKE $3
                OR sogestreng ILIKE $4
                OR sogestreng ~* $5
            )
        ORDER BY
            (sogestreng ILIKE $6) DESC,
            score DESC,
            sogestreng ASC
        LIMIT 10;
    `
    const queryParams = [
        queryString,
        queryString,
        `${queryString}%`,
        prefix,
        regexWordBoundary,
        `${queryString}%`
    ]

    try {
        const client = await pool.connect()

        try {
            await client.query('BEGIN;')

            await client.query('SET LOCAL pg_trgm.word_similarity_threshold = 0.2;')

            const result = await client.query(sql, queryParams)

            await client.query('COMMIT;')

            res.json(result.rows)
        } catch (queryErr) {
            await client.query('ROLLBACK;').catch(() => {})
            throw queryErr
        } finally {
            client.release()
        }
    } catch (err) {
        res.status(500).json({ error: err.message })
    }

})

app.listen(port, () => {
    console.log(`Test-API kører! Prøv at besøge http://localhost:${port}/husnummer?q=Dalsvej`)
})
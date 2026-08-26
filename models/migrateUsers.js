const db = require("./database");


// =====================================================
// ADD COLUMN IF IT DOESN'T EXIST
// =====================================================

function addColumnIfMissing(
  tableName,
  columnName,
  columnDefinition
) {

  return new Promise((resolve, reject) => {

    db.all(
      `PRAGMA table_info(${tableName})`,
      [],
      (err, columns) => {

        if (err) {
          reject(err);
          return;
        }


        const exists =
          columns.some(
            (column) =>
              column.name === columnName
          );


        if (exists) {

          resolve();

          return;
        }


        db.run(
          `
            ALTER TABLE ${tableName}
            ADD COLUMN ${columnName}
            ${columnDefinition}
          `,
          (error) => {

            if (error) {
              reject(error);
              return;
            }

            console.log(
              `Added ${columnName} to ${tableName}`
            );

            resolve();

          }
        );

      }
    );

  });

}


// =====================================================
// RUN USER MIGRATIONS
// =====================================================

async function migrateUsers() {

  try {

    await addColumnIfMissing(
      "users",
      "paystack_subaccount_code",
      "TEXT"
    );


    await addColumnIfMissing(
      "users",
      "paystack_connected",
      "INTEGER DEFAULT 0"
    );


    console.log(
      "User Paystack fields ready"
    );

  } catch (error) {

    console.error(
      "USER MIGRATION ERROR:",
      error
    );

  }

}


module.exports = migrateUsers;
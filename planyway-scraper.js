function getDataFromTable() {
  items = document.querySelectorAll(".pw-card");

  titles = [...items].map((item) => {
    return item.querySelector(".pw-card__title").textContent.trim();
  });

  document
    .querySelector(".k-today .k-scheduler-header-duration")
    .textContent.trim();

  t = document
    .querySelector(".k-today")
    .textContent.trim()
    .replaceAll("\n", "");

  total = t
    .split(" ")
    .filter((x) => x)
    .slice(2)
    .join(":");

  result = JSON.stringify(
    {
      total,
      titles: [...new Set(titles)],
    },
    null,
    2
  );
  return result;
}

function getRows() {
  const items = [...document.querySelectorAll("[data-item-index]")];

  let done = false;
  const rows = items
    .map((item) => {
      if (done) return;
      if (item.textContent.includes("Today")) {
        return;
      }
      if (item.textContent.includes("Yesterday")) {
        done = true;
        return;
      }

      const child = item.querySelector(":scope>div");
      const cols = [...child.querySelectorAll(":scope>div")];

      const name = [...cols[1].querySelectorAll(":scope>div")][1].textContent;

      const date = cols[2].querySelector("div").textContent;
      const time = cols[2].querySelector("input").value;

      return {
        date,
        name,
        time,
      };
    })
    .filter((x) => x);
  return rows;
}

copy(getRows());
console.log(getRows());

import fs from "fs";
const selectTsx = fs.readFileSync("src/components/ui/select.tsx", "utf-8");
console.log(selectTsx.includes("@base-ui/react/select"));

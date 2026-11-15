import { formatScalar } from "./src/core/format.ts";
console.log("A:", formatScalar(2e8, "MPa"));
console.log("B:", formatScalar(200, "MPa"));
console.log("C:", formatScalar(20, "kN·m"));
console.log("D:", formatScalar(2e8));

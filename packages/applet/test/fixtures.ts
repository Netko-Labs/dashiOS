/** A manifest every test can start from: the spec's ASUS Control. */
export const ASUS = {
  id: "dev.netko.asus-control",
  name: "ASUS Control",
  version: "0.1.0",
  dashi: ">=0.4",
  entry: "src/main.tsx",
  summary: "Fans, power and lights for ROG and TUF laptops.",
  author: { name: "Netko Labs", url: "https://netko.dev" },
  categories: ["hardware"],
  when: { vendor: "ASUSTeK COMPUTER INC.", laptop: true },
  permissions: ["hardware.power", "hardware.lighting", "dbus.system:xyz.ljones.Asusd", "notifications"],
};

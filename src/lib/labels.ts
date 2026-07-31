const LABELS: Record<string, string> = {
  PERSONAL_AUDIT: "Audyt osobisty", QUALIFICATION_CALL: "Rozmowa kwalifikacyjna", NEEDS_MORE_RESEARCH: "Wymaga dalszego researchu", SKIP: "Pomiń",
  UNQUALIFIED: "Nieskwalifikowany", NEEDS_RESEARCH: "Wymaga researchu", ICP_CONFIRMED: "ICP potwierdzone", DISQUALIFIED: "Zdyskwalifikowany",
  NEW: "Nowy", TO_CONTACT: "Do kontaktu", CONTACTED: "Skontaktowano", PAUSED: "Wstrzymany", CLOSED: "Zamknięty",
  LOW: "Niska", MEDIUM: "Średnia", HIGH: "Wysoka"
};
export const plLabel = (value: unknown) => LABELS[String(value)] ?? String(value ?? "");

import { describe, expect, it } from "vitest";
import { describePasskeyError, guessDeviceName } from "../passkeyErrors";

function domError(name: string, message = "") {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe("describePasskeyError", () => {
  it("login dibatalkan pengguna (NotAllowedError) menyarankan coba lagi atau pakai password", () => {
    const msg = describePasskeyError(domError("NotAllowedError"), "login");
    expect(msg).toContain("dibatalkan");
    expect(msg).toContain("email & password");
  });

  it("pendaftaran dibatalkan memakai kalimat pendaftaran, bukan login", () => {
    const msg = describePasskeyError(domError("NotAllowedError"), "register");
    expect(msg).toContain("Pendaftaran dibatalkan");
  });

  it("perangkat yang sudah terdaftar (InvalidStateError)", () => {
    expect(describePasskeyError(domError("InvalidStateError"), "register")).toContain("sudah terdaftar");
  });

  it("kode server passkey_disabled", () => {
    expect(describePasskeyError({ code: "passkey_disabled" }, "login")).toContain("belum diaktifkan");
  });

  it("kode server too_many_passkeys", () => {
    expect(describePasskeyError({ code: "too_many_passkeys" }, "register")).toContain("batas");
  });

  it("SecurityError (domain tidak cocok dengan RP ID)", () => {
    expect(describePasskeyError(domError("SecurityError"), "login")).toContain("tidak cocok");
  });

  it("membaca petunjuk dari cause", () => {
    const err = { name: "WebAuthnError", message: "x", cause: domError("NotAllowedError") };
    expect(describePasskeyError(err, "login")).toContain("dibatalkan");
  });

  it("cause yang melingkar tidak membuat loop tak berhenti", () => {
    const err: { cause?: unknown; message: string } = { message: "boom" };
    err.cause = err;
    expect(describePasskeyError(err, "login")).toContain("gagal");
  });

  it("error tak dikenal jatuh ke pesan umum sesuai aksi", () => {
    expect(describePasskeyError(undefined, "login")).toContain("Masuk dengan passkey gagal");
    expect(describePasskeyError("aneh", "register")).toContain("Gagal mendaftarkan");
  });
});

describe("guessDeviceName", () => {
  const date = new Date(2026, 10, 6);

  it("mengenali Android", () => {
    expect(guessDeviceName("Mozilla/5.0 (Linux; Android 14; SM-A546E)", date)).toBe(
      "HP/Tablet Android (06/11/2026)",
    );
  });

  it("iPhone didahulukan dari 'mac os' (UA iPhone memuat 'like Mac OS X')", () => {
    expect(guessDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", date)).toBe(
      "iPhone (06/11/2026)",
    );
  });

  it("Windows", () => {
    expect(guessDeviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", date)).toBe(
      "Windows (06/11/2026)",
    );
  });

  it("UA kosong jatuh ke 'Perangkat'", () => {
    expect(guessDeviceName("", date)).toBe("Perangkat (06/11/2026)");
  });
});

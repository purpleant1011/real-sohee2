// macOS only. Accepts secret bytes on stdin; never on argv, disk, clipboard, or stdout.
// Only new, user-owned review items may be created. Existing items are never overwritten.
import Foundation
import Security

func finish(_ object: [String: Any], _ code: Int32 = 0) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
    exit(code)
}

let args = CommandLine.arguments
let prefix = "example.com/PORTONE_V2_REVIEW/"
guard args.count == 4,
      ["store", "status"].contains(args[1]),
      args[2].hasPrefix(prefix), args[2].count > prefix.count,
      args[2].rangeOfCharacter(from: .controlCharacters) == nil,
      args[3] == NSUserName() else {
    finish(["error": "INVALID_ARGUMENTS"], 64)
}
let mode = args[1]
let service = args[2]
let account = args[3]
let base: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
]
var lookup = base
lookup[kSecMatchLimit as String] = kSecMatchLimitOne
lookup[kSecReturnData as String] = true
var existing: CFTypeRef?
let existingStatus = SecItemCopyMatching(lookup as CFDictionary, &existing)
if mode == "status" {
    if existingStatus == errSecItemNotFound { finish(["present": false]) }
    guard existingStatus == errSecSuccess else { finish(["error": "KEYCHAIN_LOOKUP_FAILED"], 1) }
    finish(["present": (existing as? Data)?.isEmpty == false])
}
if existingStatus == errSecSuccess { finish(["error": "ITEM_EXISTS"], 1) }
guard existingStatus == errSecItemNotFound else { finish(["error": "KEYCHAIN_LOOKUP_FAILED"], 1) }

// Secret bytes exist only in process memory; this helper does not promise secure memory erasure.
let secret = FileHandle.standardInput.readDataToEndOfFile()
guard secret.count >= 16, secret.count <= 8192,
      let text = String(data: secret, encoding: .utf8),
      text.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
    finish(["error": "INVALID_SECRET"], 65)
}
var item = base
item[kSecValueData as String] = secret
item[kSecAttrLabel as String] = "SOHEE PortOne V2 review credential (30 days)"
item[kSecAttrComment as String] = "Merchant-scope secret; intended for local TEST integration only; requested remote TTL 30 days. No production deployment approval."
item[kSecAttrSynchronizable as String] = false
let added = SecItemAdd(item as CFDictionary, nil)
if added == errSecDuplicateItem { finish(["error": "ITEM_EXISTS"], 1) }
guard added == errSecSuccess else { finish(["error": "KEYCHAIN_STORE_FAILED"], 1) }
var readback: CFTypeRef?
let verified = SecItemCopyMatching(lookup as CFDictionary, &readback)
guard verified == errSecSuccess, let bytes = readback as? Data, bytes == secret else {
    finish(["error": "KEYCHAIN_VERIFY_FAILED", "stored": true], 1)
}
finish(["stored": true, "verified": true])

"""Small streaming BIFF8 writers; no Excel installation or new dependency."""
import struct


def record(opcode, data=b""):
    return struct.pack("<HH", opcode, len(data)) + data


def _bof(kind):
    return record(0x0809, struct.pack("<HHHHII", 0x0600, kind, 0x0DBB, 1996, 0, 6))


def write_numeric_xls(path, *, rows=1, columns=1, sparse=False, sheets=1):
    """Real BIFF8, using compact MulRk rows or the final format coordinate."""
    prefix = _bof(5) + record(0x0042, struct.pack("<H", 1200)) + record(0x00E0, b"\0" * 20)
    names = [f"Sheet{i}".encode("ascii") for i in range(sheets)]
    bounds_size = sum(12 + len(name) for name in names)
    sheet_header = _bof(0x0010) + record(0x0200, struct.pack("<IIHHH", 0, rows, 0, columns, 0))
    row_bytes = record(0x027E, struct.pack("<HHHI", rows - 1, columns - 1, 0, 6)) if sparse else None
    sheet_size = len(sheet_header) + (len(row_bytes) if sparse else rows * (10 + 6 * columns)) + 4
    offset = len(prefix) + bounds_size + 4
    with path.open("wb") as stream:
        stream.write(prefix)
        for name in names:
            stream.write(record(0x0085, struct.pack("<IBBB", offset, 0, 0, len(name)) + b"\0" + name))
            offset += sheet_size
        stream.write(record(0x000A))
        for _ in names:
            stream.write(sheet_header)
            if sparse:
                stream.write(row_bytes)
            else:
                values = struct.pack("<HI", 0, 6) * columns  # Integer 1 encoded as RK.
                for row in range(rows):
                    stream.write(record(0x00BD, struct.pack("<HH", row, 0) + values + struct.pack("<H", columns - 1)))
            stream.write(record(0x000A))


def write_string_xls(path, *, rows=2000, chars=4000, sheets=1):
    """Inline BIFF8 labels with distinct text, up to the normal record size."""
    prefix = _bof(5) + record(0x0042, struct.pack("<H", 1200)) + record(0x00E0, b"\0" * 20)
    names = [f"Text{i}".encode("ascii") for i in range(sheets)]
    header = _bof(0x0010) + record(0x0200, struct.pack("<IIHHH", 0, rows, 0, 1, 0))
    size = len(header) + rows * (13 + chars) + 4
    offset = len(prefix) + sum(12 + len(name) for name in names) + 4
    with path.open("wb") as stream:
        stream.write(prefix)
        for name in names:
            stream.write(record(0x0085, struct.pack("<IBBB", offset, 0, 0, len(name)) + b"\0" + name))
            offset += size
        stream.write(record(0x000A))
        for _ in names:
            stream.write(header)
            for row in range(rows):
                text = (f"{row:05d}:" + "x" * (chars - 6)).encode("ascii")
                stream.write(record(0x0204, struct.pack("<HHHHB", row, 0, 0, chars, 0) + text))
            stream.write(record(0x000A))


def write_shared_strings_xls(path, *, count=45_000, chars=4000):
    """SST with CONTINUE boundaries between strings, and genuine cell references."""
    prefix = _bof(5) + record(0x0042, struct.pack("<H", 1200)) + record(0x00E0, b"\0" * 20)
    name = b"Strings"
    offset = len(prefix) + count * (7 + chars) + 8 + 12 + len(name) + 4
    with path.open("wb") as stream:
        stream.write(prefix)
        for index in range(count):
            text = (f"{index:05d}:" + "x" * (chars - 6)).encode("ascii")
            data = struct.pack("<HB", chars, 0) + text
            if index == 0:
                data = struct.pack("<II", count, count) + data
            stream.write(record(0x00FC if index == 0 else 0x003C, data))
        stream.write(record(0x0085, struct.pack("<IBBB", offset, 0, 0, len(name)) + b"\0" + name))
        stream.write(record(0x000A))
        stream.write(_bof(0x0010) + record(0x0200, struct.pack("<IIHHH", 0, count, 0, 1, 0)))
        for row in range(count):
            stream.write(record(0x00FD, struct.pack("<HHHI", row, 0, 0, row)))
        stream.write(record(0x000A))

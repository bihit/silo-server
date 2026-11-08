# Third-party notices

This package bundles the programs below. Each keeps its own license; the full
license texts ship with the respective component or are linked here.

| Component | Folder | License | Source |
|---|---|---|---|
| Silo (modified for native Windows) | `runtime\silo` | AGPL-3.0-or-later with the platform exception (`silo-server\LICENSE`, `silo-server\PLATFORM-EXCEPTION.md`) | the GitHub repository this release belongs to; upstream: https://github.com/Silo-Server/silo-server |
| PostgreSQL 18 (MSYS2 UCRT64 build) | `runtime\pgsql` | PostgreSQL License | https://www.postgresql.org/ftp/source/ , packaging: https://github.com/msys2/MINGW-packages |
| pgvector | `runtime\pgsql\lib\postgresql\vector.dll` | PostgreSQL License | https://github.com/pgvector/pgvector |
| MSYS2 UCRT64 runtime libraries (libvips, glib, ICU, OpenSSL, libheif, libjpeg-turbo, libpng, libwebp, zstd, zlib, GCC runtime and others) | `runtime\silo\bin`, `runtime\silo\lib`, `runtime\pgsql\bin` | each library's own license (LGPL-2.1+, MIT, BSD, Apache-2.0, ICU, zlib, GPL-3.0 with GCC Runtime Library Exception, …) | sources of every package: https://repo.msys2.org/mingw/sources/ and https://github.com/msys2/MINGW-packages |
| Microsoft Garnet | `runtime\garnet` | MIT | https://github.com/microsoft/garnet |
| .NET Runtime | `runtime\dotnet` | MIT (`runtime\dotnet\LICENSE.txt`, `ThirdPartyNotices.txt`) | https://github.com/dotnet/runtime |
| Shawl | `runtime\shawl` | MIT | https://github.com/mtkennerly/shawl |
| FFmpeg (gyan.dev "full" build) | `runtime\ffmpeg` | GPL-3.0-or-later (this build enables GPL components) | https://ffmpeg.org/download.html#get-sources , build: https://www.gyan.dev/ffmpeg/builds/ |

The Silo name and logo are trademarks of Silo Media L.L.C. (see
`silo-server\TRADEMARK.md`). This is an unofficial community test build and is
not made or supported by Silo Media.

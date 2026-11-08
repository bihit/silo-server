//go:build windows

package pathscope

import "testing"

// The Windows separator is the LIKE escape character: the trailing separator
// must be escaped, or `\%` makes the wildcard a literal percent sign and no
// file under the root matches.
func TestPrefixLikeEscapesWindowsSeparator(t *testing.T) {
	for _, tc := range []struct{ root, want string }{
		{`D:\Movies 6`, `D:\\Movies 6\\%`},
		{`D:\Movies 6\`, `D:\\Movies 6\\%`},
		{`E:\Short_films 100%`, `E:\\Short\_films 100\%\\%`},
	} {
		if got := PrefixLike(tc.root); got != tc.want {
			t.Errorf("PrefixLike(%q) = %q, want %q", tc.root, got, tc.want)
		}
	}
}
